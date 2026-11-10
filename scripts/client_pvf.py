"""Read selected files and script tokens from a local DNF PVF archive."""
import struct
import numpy as np

class PvfArchive:
    def __init__(self, source):
        self.stream = source.open('rb')
        try:
            size, = struct.unpack('<I', self.stream.read(4))
            self.stream.read(size)
            self.version, size, key, count = struct.unpack('<4I', self.stream.read(16))
            self.base = self.stream.tell() + size
            tree = self._decrypt(self.stream.read(size), key)
            self.entries = {}
            pos = 0
            for _ in range(count):
                _, length = struct.unpack_from('<2I', tree, pos)
                pos += 8
                name = tree[pos:pos+length].decode('cp949', errors='replace').replace('\\', '/').lower()
                pos += length
                self.entries[name] = struct.unpack_from('<3I', tree, pos)
                pos += 12
            self.strings = self.read('stringtable.bin')
        except BaseException:
            self.stream.close()
            raise

    @staticmethod
    def _decrypt(data, key):
        words = np.frombuffer(data, dtype='<u4') ^ np.uint32(key ^ 0x81A79011)
        return ((words >> 6) | (words << 26)).tobytes()

    def read(self, name):
        size, key, offset = self.entries[name.replace('\\', '/').lower()]
        self.stream.seek(self.base + offset)
        return self._decrypt(self.stream.read((size + 3) & ~3), key)[:size]

    def tokens(self, name):
        raw = self.read(name)
        out = []
        for pos in range(2, len(raw) - 4, 5):
            kind = raw[pos]
            value, = struct.unpack_from('<I', raw, pos + 1)
            if kind in [5, 6, 7, 8, 10]:
                start, end = struct.unpack_from('<2I', self.strings, 4 + value * 4)
                value = self.strings[4+start:4+end].decode('big5', errors='replace')
            elif kind == 4:
                value, = struct.unpack_from('<f', raw, pos + 1)
            out.append([kind, value])
        return out

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stream.close()
