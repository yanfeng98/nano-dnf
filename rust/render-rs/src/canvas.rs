//! 2D software canvas wrapper over `tiny_skia` and `fontdue` with glyph caching.

use core_rs::constants::{VIEW_HEIGHT, VIEW_LEFT, VIEW_WIDTH};
use fontdue::{Font, Metrics};
use std::collections::HashMap;
use tiny_skia::{
    Color, FillRule, IntSize, Mask, Paint, PathBuilder, Pixmap, PixmapPaint, Rect, Stroke,
    Transform,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    pub fn from_hex(hex: &str) -> Self {
        let s = hex.trim_start_matches('#');
        if s.len() == 6 {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(255);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(255);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(255);
            return Self::new(r, g, b, 255);
        }
        Self::new(255, 255, 255, 255)
    }

    pub fn with_alpha(self, alpha: f32) -> Self {
        let a = ((f32::from(self.a) * alpha.clamp(0.0, 1.0)) + 0.5) as u8;
        Self { a, ..self }
    }

    fn to_skia(self) -> Color {
        Color::from_rgba8(self.r, self.g, self.b, self.a)
    }
}

pub struct GlyphCache {
    fonts: Vec<Font>,
    glyphs: HashMap<(char, u16), (Metrics, Vec<u8>)>,
}

impl GlyphCache {
    pub fn new(font_bytes: Option<&[u8]>) -> Self {
        match font_bytes {
            Some(bytes) => Self::from_font_blobs(&[bytes]),
            None => Self::from_font_blobs(&[]),
        }
    }

    pub fn from_font_blobs(blobs: &[&[u8]]) -> Self {
        let fonts = blobs
            .iter()
            .filter_map(|bytes| Font::from_bytes(*bytes, fontdue::FontSettings::default()).ok())
            .collect();
        Self {
            fonts,
            glyphs: HashMap::new(),
        }
    }

    fn font_for(&self, ch: char) -> Option<&Font> {
        self.fonts
            .iter()
            .find(|f| f.lookup_glyph_index(ch) != 0)
            .or_else(|| self.fonts.first())
    }

    pub fn rasterize(&mut self, ch: char, px_tenths: u16) -> Option<&(Metrics, Vec<u8>)> {
        if self.fonts.is_empty() {
            return None;
        }
        let key = (ch, px_tenths);
        if !self.glyphs.contains_key(&key) {
            let font = self.font_for(ch)?;
            let size = f32::from(px_tenths) / 10.0;
            let raster = font.rasterize(ch, size);
            self.glyphs.insert(key, raster);
        }
        self.glyphs.get(&key)
    }

    pub fn measure_text(&mut self, text: &str, size: f32) -> f32 {
        if self.fonts.is_empty() {
            return text.chars().count() as f32 * size * 0.6;
        }
        let mut width = 0.0f32;
        for ch in text.chars() {
            if let Some(font) = self.font_for(ch) {
                let metrics = font.metrics(ch, size);
                width += metrics.advance_width;
            } else {
                width += size * 0.6;
            }
        }
        width
    }
}

#[derive(Debug, Clone, Copy)]
enum ClipShape {
    Rect(Rect),
    Circle { cx: f32, cy: f32, rx: f32, ry: f32 },
}

pub struct Canvas<'a> {
    pub pixmap: &'a mut Pixmap,
    pub fonts: &'a mut GlyphCache,
    clip: Option<Mask>,
    transform: Transform,
    stack: Vec<(Transform, Option<ClipShape>)>,
    clip_shape: Option<ClipShape>,
}

impl<'a> Canvas<'a> {
    pub fn new(pixmap: &'a mut Pixmap, fonts: &'a mut GlyphCache) -> Self {
        let transform = if pixmap.width() * 3 == pixmap.height() * 4 {
            let sx = pixmap.width() as f32 / VIEW_WIDTH as f32;
            let sy = pixmap.height() as f32 / VIEW_HEIGHT as f32;
            Transform::from_scale(sx, sy).pre_translate(-(VIEW_LEFT as f32), 0.0)
        } else {
            Transform::identity()
        };
        Self {
            pixmap,
            fonts,
            clip: None,
            transform,
            stack: Vec::new(),
            clip_shape: None,
        }
    }

    pub fn save(&mut self) {
        self.stack.push((self.transform, self.clip_shape));
    }

    pub fn restore(&mut self) {
        if let Some((t, cs)) = self.stack.pop() {
            self.transform = t;
            self.set_clip_shape(cs);
        }
    }

    pub fn translate(&mut self, tx: f32, ty: f32) {
        self.transform = self.transform.pre_translate(tx, ty);
    }

    pub fn scale(&mut self, sx: f32, sy: f32) {
        self.transform = self.transform.pre_scale(sx, sy);
    }

    pub fn set_clip_rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        let mapped = self.map_rect(x, y, w, h).map(ClipShape::Rect);
        self.set_clip_shape(mapped);
    }

    pub fn set_clip_circle(&mut self, cx: f32, cy: f32, radius: f32) {
        if radius <= 0.0 {
            self.set_clip_shape(None);
            return;
        }
        let mut pts = [
            tiny_skia::Point::from_xy(cx, cy),
            tiny_skia::Point::from_xy(cx + radius, cy),
            tiny_skia::Point::from_xy(cx, cy + radius),
        ];
        self.transform.map_points(&mut pts);
        let rx = (pts[1].x - pts[0].x).hypot(pts[1].y - pts[0].y);
        let ry = (pts[2].x - pts[0].x).hypot(pts[2].y - pts[0].y);
        self.set_clip_shape(Some(ClipShape::Circle {
            cx: pts[0].x,
            cy: pts[0].y,
            rx: rx.max(0.01),
            ry: ry.max(0.01),
        }));
    }

    fn map_rect(&self, x: f32, y: f32, w: f32, h: f32) -> Option<Rect> {
        let mut pts = [
            tiny_skia::Point::from_xy(x, y),
            tiny_skia::Point::from_xy(x + w, y + h),
        ];
        self.transform.map_points(&mut pts);
        let x0 = pts[0].x.min(pts[1].x);
        let y0 = pts[0].y.min(pts[1].y);
        let rw = (pts[1].x - pts[0].x).abs();
        let rh = (pts[1].y - pts[0].y).abs();
        Rect::from_xywh(x0, y0, rw.max(0.01), rh.max(0.01))
    }

    fn set_clip_shape(&mut self, shape: Option<ClipShape>) {
        self.clip_shape = shape;
        if let Some(s) = shape {
            if let Some(mut mask) = Mask::new(self.pixmap.width(), self.pixmap.height()) {
                match s {
                    ClipShape::Rect(r) => {
                        let path = PathBuilder::from_rect(r);
                        mask.fill_path(&path, FillRule::Winding, false, Transform::identity());
                        self.clip = Some(mask);
                        return;
                    }
                    ClipShape::Circle { cx, cy, rx, ry } => {
                        if let Some(rect) = Rect::from_xywh(cx - rx, cy - ry, rx * 2.0, ry * 2.0) {
                            if let Some(path) = PathBuilder::from_oval(rect) {
                                mask.fill_path(
                                    &path,
                                    FillRule::Winding,
                                    true,
                                    Transform::identity(),
                                );
                                self.clip = Some(mask);
                                return;
                            }
                        }
                    }
                }
            }
        }
        self.clip = None;
    }

    pub fn clear(&mut self, color: Rgba) {
        self.pixmap.fill(color.to_skia());
    }

    pub fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Rgba) {
        if w <= 0.0 || h <= 0.0 || color.a == 0 {
            return;
        }
        let Some(rect) = Rect::from_xywh(x, y, w, h) else {
            return;
        };
        let mut paint = Paint::default();
        paint.set_color(color.to_skia());
        paint.anti_alias = false;
        self.pixmap
            .fill_rect(rect, &paint, self.transform, self.clip.as_ref());
    }

    /// Fill a clockwise radial/pie cooldown sweep clipped to `(x, y, w, h)`.
    /// `ratio` in `(0.0, 1.0]` is the remaining cooldown fraction starting from 12 o'clock.
    pub fn fill_radial_pie(&mut self, x: f32, y: f32, w: f32, h: f32, ratio: f32, color: Rgba) {
        let ratio = ratio.clamp(0.0, 1.0);
        if w <= 0.0 || h <= 0.0 || color.a == 0 || ratio <= 0.001 {
            return;
        }
        if ratio >= 0.999 {
            self.fill_rect(x, y, w, h, color);
            return;
        }
        let cx = x + w * 0.5;
        let cy = y + h * 0.5;
        let radius = (w * w + h * h).sqrt();
        let start = -std::f32::consts::FRAC_PI_2;
        let sweep = std::f32::consts::TAU * ratio;
        let steps = ((ratio * 24.0).ceil() as usize).clamp(4, 24);

        let mut pb = PathBuilder::new();
        pb.move_to(cx, cy);
        for i in 0..=steps {
            let angle = start + sweep * (i as f32 / steps as f32);
            pb.line_to(cx + angle.cos() * radius, cy + angle.sin() * radius);
        }
        pb.close();

        if let Some(path) = pb.finish() {
            self.save();
            self.set_clip_rect(x, y, w, h);
            let mut paint = Paint::default();
            paint.set_color(color.to_skia());
            paint.anti_alias = true;
            self.pixmap.fill_path(
                &path,
                &paint,
                FillRule::Winding,
                self.transform,
                self.clip.as_ref(),
            );
            self.restore();
        }
    }

    pub fn stroke_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Rgba, width: f32) {
        if w <= 0.0 || h <= 0.0 || color.a == 0 {
            return;
        }
        let Some(rect) = Rect::from_xywh(x, y, w, h) else {
            return;
        };
        let path = PathBuilder::from_rect(rect);
        let mut paint = Paint::default();
        paint.set_color(color.to_skia());
        paint.anti_alias = true;
        let stroke = Stroke {
            width,
            ..Stroke::default()
        };
        self.pixmap
            .stroke_path(&path, &paint, &stroke, self.transform, self.clip.as_ref());
    }

    pub fn fill_round_rect(&mut self, x: f32, y: f32, w: f32, h: f32, r: f32, color: Rgba) {
        if w <= 0.0 || h <= 0.0 || color.a == 0 {
            return;
        }
        let r = r.min(w * 0.5).min(h * 0.5).max(0.0);
        if r <= 0.5 {
            self.fill_rect(x, y, w, h, color);
            return;
        }
        let mut pb = PathBuilder::new();
        pb.move_to(x + r, y);
        pb.line_to(x + w - r, y);
        pb.quad_to(x + w, y, x + w, y + r);
        pb.line_to(x + w, y + h - r);
        pb.quad_to(x + w, y + h, x + w - r, y + h);
        pb.line_to(x + r, y + h);
        pb.quad_to(x, y + h, x, y + h - r);
        pb.line_to(x, y + r);
        pb.quad_to(x, y, x + r, y);
        pb.close();
        if let Some(path) = pb.finish() {
            let mut paint = Paint::default();
            paint.set_color(color.to_skia());
            paint.anti_alias = true;
            self.pixmap.fill_path(
                &path,
                &paint,
                FillRule::Winding,
                self.transform,
                self.clip.as_ref(),
            );
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "canvas stroke_round_rect matches Canvas2D API"
    )]
    pub fn stroke_round_rect(
        &mut self,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        r: f32,
        color: Rgba,
        width: f32,
    ) {
        if w <= 0.0 || h <= 0.0 || color.a == 0 {
            return;
        }
        let r = r.min(w * 0.5).min(h * 0.5).max(0.0);
        if r <= 0.5 {
            self.stroke_rect(x, y, w, h, color, width);
            return;
        }
        let mut pb = PathBuilder::new();
        pb.move_to(x + r, y);
        pb.line_to(x + w - r, y);
        pb.quad_to(x + w, y, x + w, y + r);
        pb.line_to(x + w, y + h - r);
        pb.quad_to(x + w, y + h, x + w - r, y + h);
        pb.line_to(x + r, y + h);
        pb.quad_to(x, y + h, x, y + h - r);
        pb.line_to(x, y + r);
        pb.quad_to(x, y, x + r, y);
        pb.close();
        if let Some(path) = pb.finish() {
            let mut paint = Paint::default();
            paint.set_color(color.to_skia());
            paint.anti_alias = true;
            let stroke = Stroke {
                width,
                ..Stroke::default()
            };
            self.pixmap
                .stroke_path(&path, &paint, &stroke, self.transform, self.clip.as_ref());
        }
    }

    fn build_ellipse(cx: f32, cy: f32, rx: f32, ry: f32) -> Option<tiny_skia::Path> {
        if rx <= 0.0 || ry <= 0.0 {
            return None;
        }
        const K: f32 = 0.552_284_8;
        let ox = rx * K;
        let oy = ry * K;
        let mut pb = PathBuilder::new();
        pb.move_to(cx - rx, cy);
        pb.cubic_to(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
        pb.cubic_to(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
        pb.cubic_to(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
        pb.cubic_to(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
        pb.close();
        pb.finish()
    }

    pub fn fill_ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, color: Rgba) {
        if color.a == 0 {
            return;
        }
        if let Some(path) = Self::build_ellipse(cx, cy, rx, ry) {
            let mut paint = Paint::default();
            paint.set_color(color.to_skia());
            paint.anti_alias = true;
            self.pixmap.fill_path(
                &path,
                &paint,
                FillRule::Winding,
                self.transform,
                self.clip.as_ref(),
            );
        }
    }

    pub fn stroke_ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, color: Rgba, width: f32) {
        if color.a == 0 {
            return;
        }
        if let Some(path) = Self::build_ellipse(cx, cy, rx, ry) {
            let mut paint = Paint::default();
            paint.set_color(color.to_skia());
            paint.anti_alias = true;
            let stroke = Stroke {
                width,
                ..Stroke::default()
            };
            self.pixmap
                .stroke_path(&path, &paint, &stroke, self.transform, self.clip.as_ref());
        }
    }

    pub fn draw_line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, color: Rgba, width: f32) {
        if color.a == 0 {
            return;
        }
        let mut pb = PathBuilder::new();
        pb.move_to(x1, y1);
        pb.line_to(x2, y2);
        if let Some(path) = pb.finish() {
            let mut paint = Paint::default();
            paint.set_color(color.to_skia());
            paint.anti_alias = true;
            let stroke = Stroke {
                width,
                ..Stroke::default()
            };
            self.pixmap
                .stroke_path(&path, &paint, &stroke, self.transform, self.clip.as_ref());
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn draw_image(
        &mut self,
        sheet: &Pixmap,
        sx: u32,
        sy: u32,
        sw: u32,
        sh: u32,
        dx: f32,
        dy: f32,
        dw: f32,
        dh: f32,
        flip_x: bool,
        alpha: f32,
        angle_rad: f32,
    ) {
        self.draw_image_blend(
            sheet,
            sx,
            sy,
            sw,
            sh,
            dx,
            dy,
            dw,
            dh,
            flip_x,
            alpha,
            angle_rad,
            tiny_skia::BlendMode::SourceOver,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn draw_image_additive(
        &mut self,
        sheet: &Pixmap,
        sx: u32,
        sy: u32,
        sw: u32,
        sh: u32,
        dx: f32,
        dy: f32,
        dw: f32,
        dh: f32,
        flip_x: bool,
        alpha: f32,
        angle_rad: f32,
    ) {
        self.draw_image_blend(
            sheet,
            sx,
            sy,
            sw,
            sh,
            dx,
            dy,
            dw,
            dh,
            flip_x,
            alpha,
            angle_rad,
            tiny_skia::BlendMode::Plus,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_image_blend(
        &mut self,
        sheet: &Pixmap,
        sx: u32,
        sy: u32,
        sw: u32,
        sh: u32,
        dx: f32,
        dy: f32,
        dw: f32,
        dh: f32,
        flip_x: bool,
        alpha: f32,
        angle_rad: f32,
        blend_mode: tiny_skia::BlendMode,
    ) {
        if sw == 0 || sh == 0 || dw <= 0.0 || dh <= 0.0 || alpha <= 0.0 {
            return;
        }
        let Some(sub_rect) = tiny_skia::IntRect::from_xywh(sx as i32, sy as i32, sw, sh) else {
            return;
        };
        let Some(sub) = sheet.clone_rect(sub_rect) else {
            return;
        };
        let scale_x = dw / sw as f32;
        let scale_y = dh / sh as f32;
        let mut t = self.transform;
        if angle_rad != 0.0 {
            let cx = dx + dw * 0.5;
            let cy = dy + dh * 0.5;
            t = t
                .pre_translate(cx, cy)
                .pre_rotate(angle_rad.to_degrees())
                .pre_translate(-dw * 0.5, -dh * 0.5);
        } else {
            t = t.pre_translate(dx, dy);
        }
        if flip_x {
            t = t.pre_translate(dw, 0.0).pre_scale(-scale_x, scale_y);
        } else {
            t = t.pre_scale(scale_x, scale_y);
        }
        let paint = PixmapPaint {
            opacity: alpha.clamp(0.0, 1.0),
            blend_mode,
            quality: tiny_skia::FilterQuality::Nearest,
        };
        self.pixmap
            .draw_pixmap(0, 0, sub.as_ref(), &paint, t, self.clip.as_ref());
    }

    #[allow(clippy::too_many_arguments)]
    pub fn draw_image_white_silhouette(
        &mut self,
        sheet: &Pixmap,
        sx: u32,
        sy: u32,
        sw: u32,
        sh: u32,
        dx: f32,
        dy: f32,
        dw: f32,
        dh: f32,
        flip_x: bool,
        alpha: f32,
    ) {
        if sw == 0 || sh == 0 || dw <= 0.0 || dh <= 0.0 || alpha <= 0.0 {
            return;
        }
        let Some(sub_rect) = tiny_skia::IntRect::from_xywh(sx as i32, sy as i32, sw, sh) else {
            return;
        };
        let Some(mut sub) = sheet.clone_rect(sub_rect) else {
            return;
        };
        for px in sub.data_mut().chunks_exact_mut(4) {
            if px[3] > 32 {
                px[0] = 255;
                px[1] = 255;
                px[2] = 255;
                px[3] = 255;
            } else {
                px[0] = 0;
                px[1] = 0;
                px[2] = 0;
                px[3] = 0;
            }
        }
        let scale_x = dw / sw as f32;
        let scale_y = dh / sh as f32;
        let mut t = self.transform.pre_translate(dx, dy);
        if flip_x {
            t = t.pre_translate(dw, 0.0).pre_scale(-scale_x, scale_y);
        } else {
            t = t.pre_scale(scale_x, scale_y);
        }
        let paint = PixmapPaint {
            opacity: alpha.clamp(0.0, 1.0),
            blend_mode: tiny_skia::BlendMode::SourceOver,
            quality: tiny_skia::FilterQuality::Nearest,
        };
        self.pixmap
            .draw_pixmap(0, 0, sub.as_ref(), &paint, t, self.clip.as_ref());
    }

    #[allow(clippy::too_many_arguments)]
    pub fn fill_text(
        &mut self,
        text: &str,
        x: f32,
        y: f32,
        size: f32,
        color: Rgba,
        align: TextAlign,
        outline: Option<Rgba>,
    ) {
        if text.is_empty() || color.a == 0 {
            return;
        }
        let eff_size = (size * self.transform.sy).max(6.0);
        let total_w = self.fonts.measure_text(text, eff_size);
        let mut pt = tiny_skia::Point::from_xy(x, y);
        self.transform.map_point(&mut pt);
        let start_x = match align {
            TextAlign::Left => pt.x,
            TextAlign::Center => pt.x - total_w * 0.5,
            TextAlign::Right => pt.x - total_w,
        };
        let baseline_y = pt.y;
        let px_tenths = (eff_size * 10.0).round().clamp(60.0, 2000.0) as u16;

        if let Some(oc) = outline {
            for [ox, oy] in [[-1.0, 0.0], [1.0, 0.0], [0.0, -1.0], [0.0, 1.0]] {
                self.blit_text_run(text, start_x + ox, baseline_y + oy, px_tenths, oc);
            }
        }
        self.blit_text_run(text, start_x, baseline_y, px_tenths, color);
    }

    /// Bold italic metallic silver-white text with dark outline (DNF live rating panel grade & fallback).
    pub fn fill_text_metallic_italic(
        &mut self,
        text: &str,
        x: f32,
        y: f32,
        size: f32,
        align: TextAlign,
        alpha: f32,
    ) {
        if text.is_empty() || alpha <= 0.01 {
            return;
        }
        let eff_size = (size * self.transform.sy).max(6.0);
        let total_w = self.fonts.measure_text(text, eff_size) + 2.0;
        let mut pt = tiny_skia::Point::from_xy(x, y);
        self.transform.map_point(&mut pt);
        let start_x = match align {
            TextAlign::Left => pt.x,
            TextAlign::Center => pt.x - total_w * 0.5,
            TextAlign::Right => pt.x - total_w,
        };
        let baseline_y = pt.y;
        let px_tenths = (eff_size * 10.0).round().clamp(60.0, 2000.0) as u16;
        let outline = Rgba::new(8, 10, 16, 235).with_alpha(alpha);
        for [ox, oy] in [
            [-1.5, -1.0],
            [0.0, -1.5],
            [1.5, -1.0],
            [-1.5, 0.0],
            [2.0, 0.0],
            [-1.5, 1.0],
            [0.0, 1.5],
            [1.5, 1.0],
        ] {
            self.blit_text_run_slanted(
                text,
                start_x + ox,
                baseline_y + oy,
                px_tenths,
                None,
                outline,
            );
        }
        // Faux-bold + metallic vertical gradient (bright silver-white top -> cool steel bottom)
        let top_col = Rgba::new(246, 248, 252, 255).with_alpha(alpha);
        let bot_col = Rgba::new(176, 182, 190, 255).with_alpha(alpha);
        self.blit_text_run_slanted(
            text,
            start_x + 0.8,
            baseline_y,
            px_tenths,
            Some(bot_col),
            top_col,
        );
        self.blit_text_run_slanted(text, start_x, baseline_y, px_tenths, Some(bot_col), top_col);
    }

    fn blit_text_run_slanted(
        &mut self,
        text: &str,
        start_x: f32,
        baseline_y: f32,
        px_tenths: u16,
        bottom_color: Option<Rgba>,
        top_color: Rgba,
    ) {
        let pw = self.pixmap.width() as i32;
        let ph = self.pixmap.height() as i32;
        let clip_shape = self.clip_shape;
        let mut pen_x = start_x;
        let mut draw_ops: Vec<(i32, i32, usize, usize, Vec<u8>)> = Vec::new();
        for ch in text.chars() {
            if let Some((metrics, bitmap)) = self.fonts.rasterize(ch, px_tenths) {
                let gx = (pen_x + metrics.xmin as f32).round() as i32;
                let gy = (baseline_y - metrics.ymin as f32 - metrics.height as f32).round() as i32;
                if metrics.width > 0 && metrics.height > 0 {
                    draw_ops.push((gx, gy, metrics.width, metrics.height, bitmap.clone()));
                }
                pen_x += metrics.advance_width + 0.6;
            } else {
                pen_x += f32::from(px_tenths) / 10.0 * 0.5;
            }
        }
        let data = self.pixmap.data_mut();
        for (gx, gy, gw, gh, bitmap) in draw_ops {
            let denom = (gh.saturating_sub(1)).max(1) as f32;
            for row in 0..gh {
                let py = gy + row as i32;
                if py < 0 || py >= ph {
                    continue;
                }
                if let Some(ClipShape::Rect(cr)) = clip_shape {
                    if (py as f32) < cr.top() || (py as f32) >= cr.bottom() {
                        continue;
                    }
                }
                let t = row as f32 / denom;
                let col_rgba = match bottom_color {
                    Some(bc) => Rgba::new(
                        (f32::from(top_color.r) * (1.0 - t) + f32::from(bc.r) * t) as u8,
                        (f32::from(top_color.g) * (1.0 - t) + f32::from(bc.g) * t) as u8,
                        (f32::from(top_color.b) * (1.0 - t) + f32::from(bc.b) * t) as u8,
                        (f32::from(top_color.a) * (1.0 - t) + f32::from(bc.a) * t) as u8,
                    ),
                    None => top_color,
                };
                let sr = f32::from(col_rgba.r);
                let sg = f32::from(col_rgba.g);
                let sb = f32::from(col_rgba.b);
                let sa = f32::from(col_rgba.a) / 255.0;
                let shear =
                    ((gh.saturating_sub(1).saturating_sub(row)) as f32 * 0.24).round() as i32;
                for col in 0..gw {
                    let px = gx + col as i32 + shear;
                    if px < 0 || px >= pw {
                        continue;
                    }
                    match clip_shape {
                        Some(ClipShape::Rect(cr)) => {
                            if (px as f32) < cr.left() || (px as f32) >= cr.right() {
                                continue;
                            }
                        }
                        Some(ClipShape::Circle { cx, cy, rx, ry }) => {
                            let dx = (px as f32 - cx) / rx;
                            let dy = (py as f32 - cy) / ry;
                            if dx * dx + dy * dy > 1.0 {
                                continue;
                            }
                        }
                        None => {}
                    }
                    let cov = bitmap[row * gw + col];
                    if cov == 0 {
                        continue;
                    }
                    let alpha = (f32::from(cov) / 255.0) * sa;
                    let inv = 1.0 - alpha;
                    let idx = ((py * pw + px) * 4) as usize;
                    let dr = f32::from(data[idx]);
                    let dg = f32::from(data[idx + 1]);
                    let db = f32::from(data[idx + 2]);
                    let da = f32::from(data[idx + 3]);
                    data[idx] = (sr * alpha + dr * inv).min(255.0) as u8;
                    data[idx + 1] = (sg * alpha + dg * inv).min(255.0) as u8;
                    data[idx + 2] = (sb * alpha + db * inv).min(255.0) as u8;
                    data[idx + 3] = (255.0 * alpha + da * inv).min(255.0) as u8;
                }
            }
        }
    }

    fn blit_text_run(
        &mut self,
        text: &str,
        start_x: f32,
        baseline_y: f32,
        px_tenths: u16,
        color: Rgba,
    ) {
        let pw = self.pixmap.width() as i32;
        let ph = self.pixmap.height() as i32;
        let clip_shape = self.clip_shape;
        let mut pen_x = start_x;
        let mut draw_ops: Vec<(i32, i32, usize, usize, Vec<u8>)> = Vec::new();
        for ch in text.chars() {
            if let Some((metrics, bitmap)) = self.fonts.rasterize(ch, px_tenths) {
                let gx = (pen_x + metrics.xmin as f32).round() as i32;
                let gy = (baseline_y - metrics.ymin as f32 - metrics.height as f32).round() as i32;
                if metrics.width > 0 && metrics.height > 0 {
                    draw_ops.push((gx, gy, metrics.width, metrics.height, bitmap.clone()));
                }
                pen_x += metrics.advance_width;
            } else {
                pen_x += f32::from(px_tenths) / 10.0 * 0.5;
            }
        }
        let data = self.pixmap.data_mut();
        let sr = f32::from(color.r);
        let sg = f32::from(color.g);
        let sb = f32::from(color.b);
        let sa = f32::from(color.a) / 255.0;

        for (gx, gy, gw, gh, bitmap) in draw_ops {
            for row in 0..gh {
                let py = gy + row as i32;
                if py < 0 || py >= ph {
                    continue;
                }
                if let Some(ClipShape::Rect(cr)) = clip_shape {
                    if (py as f32) < cr.top() || (py as f32) >= cr.bottom() {
                        continue;
                    }
                }
                for col in 0..gw {
                    let px = gx + col as i32;
                    if px < 0 || px >= pw {
                        continue;
                    }
                    match clip_shape {
                        Some(ClipShape::Rect(cr)) => {
                            if (px as f32) < cr.left() || (px as f32) >= cr.right() {
                                continue;
                            }
                        }
                        Some(ClipShape::Circle { cx, cy, rx, ry }) => {
                            let dx = (px as f32 - cx) / rx;
                            let dy = (py as f32 - cy) / ry;
                            if dx * dx + dy * dy > 1.0 {
                                continue;
                            }
                        }
                        None => {}
                    }
                    let cov = bitmap[row * gw + col];
                    if cov == 0 {
                        continue;
                    }
                    let alpha = (f32::from(cov) / 255.0) * sa;
                    let inv = 1.0 - alpha;
                    let idx = ((py * pw + px) * 4) as usize;
                    let dr = f32::from(data[idx]);
                    let dg = f32::from(data[idx + 1]);
                    let db = f32::from(data[idx + 2]);
                    let da = f32::from(data[idx + 3]);
                    data[idx] = (sr * alpha + dr * inv).min(255.0) as u8;
                    data[idx + 1] = (sg * alpha + dg * inv).min(255.0) as u8;
                    data[idx + 2] = (sb * alpha + db * inv).min(255.0) as u8;
                    data[idx + 3] = (255.0 * alpha + da * inv).min(255.0) as u8;
                }
            }
        }
    }

    pub fn ensure_size(w: u32, h: u32) -> Option<Pixmap> {
        IntSize::from_wh(w, h).and_then(|s| Pixmap::new(s.width(), s.height()))
    }
}
