//! 2D software canvas wrapper over `tiny_skia` and `fontdue` with glyph caching.

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
    font: Option<Font>,
    glyphs: HashMap<(char, u16), (Metrics, Vec<u8>)>,
}

impl GlyphCache {
    pub fn new(font_bytes: Option<&[u8]>) -> Self {
        let font = font_bytes
            .and_then(|bytes| Font::from_bytes(bytes, fontdue::FontSettings::default()).ok());
        Self {
            font,
            glyphs: HashMap::new(),
        }
    }

    pub fn rasterize(&mut self, ch: char, px_tenths: u16) -> Option<&(Metrics, Vec<u8>)> {
        let font = self.font.as_ref()?;
        let key = (ch, px_tenths);
        let entry = self.glyphs.entry(key).or_insert_with(|| {
            let size = f32::from(px_tenths) / 10.0;
            font.rasterize(ch, size)
        });
        Some(entry)
    }

    pub fn measure_text(&mut self, text: &str, size: f32) -> f32 {
        let Some(ref font) = self.font else {
            return text.chars().count() as f32 * size * 0.6;
        };
        let mut width = 0.0f32;
        for ch in text.chars() {
            let metrics = font.metrics(ch, size);
            width += metrics.advance_width;
        }
        width
    }
}

pub struct Canvas<'a> {
    pub pixmap: &'a mut Pixmap,
    pub fonts: &'a mut GlyphCache,
    clip: Option<Mask>,
    transform: Transform,
    stack: Vec<(Transform, Option<Rect>)>,
    clip_rect_opt: Option<Rect>,
}

impl<'a> Canvas<'a> {
    pub fn new(pixmap: &'a mut Pixmap, fonts: &'a mut GlyphCache) -> Self {
        Self {
            pixmap,
            fonts,
            clip: None,
            transform: Transform::identity(),
            stack: Vec::new(),
            clip_rect_opt: None,
        }
    }

    pub fn save(&mut self) {
        self.stack.push((self.transform, self.clip_rect_opt));
    }

    pub fn restore(&mut self) {
        if let Some((t, cr)) = self.stack.pop() {
            self.transform = t;
            self.set_clip_rect_opt(cr);
        }
    }

    pub fn translate(&mut self, tx: f32, ty: f32) {
        self.transform = self.transform.pre_translate(tx, ty);
    }

    pub fn scale(&mut self, sx: f32, sy: f32) {
        self.transform = self.transform.pre_scale(sx, sy);
    }

    pub fn set_clip_rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        let mapped = self.map_rect(x, y, w, h);
        self.set_clip_rect_opt(mapped);
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

    fn set_clip_rect_opt(&mut self, rect_opt: Option<Rect>) {
        self.clip_rect_opt = rect_opt;
        if let Some(r) = rect_opt {
            if let Some(mut mask) = Mask::new(self.pixmap.width(), self.pixmap.height()) {
                let path = PathBuilder::from_rect(r);
                mask.fill_path(&path, FillRule::Winding, false, Transform::identity());
                self.clip = Some(mask);
                return;
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
        let clip_bounds = self.clip_rect_opt;
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
                if let Some(cr) = clip_bounds {
                    if (py as f32) < cr.top() || (py as f32) >= cr.bottom() {
                        continue;
                    }
                }
                for col in 0..gw {
                    let px = gx + col as i32;
                    if px < 0 || px >= pw {
                        continue;
                    }
                    if let Some(cr) = clip_bounds {
                        if (px as f32) < cr.left() || (px as f32) >= cr.right() {
                            continue;
                        }
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
