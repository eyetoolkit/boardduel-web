"""
生成 public/apple-touch-icon.png（180×180，opaque 背景）。

为什么不用 ImageMagick / Pillow：本机都没装（`convert` 是 Windows 自带的磁盘转换工具），
为一个图标装依赖不划算。PNG 编码器手写即可 —— 只需 zlib（标准库）+ struct。

图标设计与 public/favicon.svg 保持一致：
  · 底色 #0E1419（深炭）
  · 圆角视觉由iOS 自己裁切（Apple 会加自己的圆角遮罩），所以这里画满方形
  · 字母 B 白、字母 D 橙（#FF6A3C），与 favicon 的 `B<tspan fill="#FF6A3C">D</tspan>` 对应
  · 字体用无衬线粗体近似（Pillow 缺席，无法真实渲染 Bricolage Grotesk）

2026-10-07 背景：7 个 lobby 页引用了 /apple-touch-icon.png 但文件不存在 → 线上 404。
影响：iOS「添加到主屏幕」时无图标（Safari 会自己截屏兜底，非致命但属缺陷）。
"""
import zlib, struct, os

W = H = 180
BG = (0x0E, 0x14, 0x19)
FG = (0xF4, 0xF6, 0xF2)
ACCENT = (0xFF, 0x6A, 0x3C)

# 5×7 位图字模（B 与 D），放大到目标尺寸
BMP_B = [
    "11110",
    "10001",
    "10001",
    "11110",
    "10001",
    "10001",
    "11110",
]
BMP_D = [
    "11110",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
    "11110",
]

# 布局：两个字母并排居中
SCALE = 18          # 每个点18px → 字母高 7*18=126px
GAP = 6 * SCALE     # 字母间距 6 点
MARGIN_X = (W - (5 * SCALE) * 2 - GAP) // 2
MARGIN_Y = (H - 7 * SCALE) // 2


def put(px, x, y, color):
    """写入单个像素。px 是 bytearray(RGB 三元组序列)，需按字节展开——bytearray 不能赋三元组。"""
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        px[i] = color[0]
        px[i + 1] = color[1]
        px[i + 2] = color[2]


def draw_glyph(px, glyph, ox, oy, color):
    for ry, row in enumerate(glyph):
        for rx, ch in enumerate(row):
            if ch != "1":
                continue
            x0 = ox + rx * SCALE
            y0 = oy + ry * SCALE
            for dy in range(SCALE):
                for dx in range(SCALE):
                    put(px, x0 + dx, y0 + dy, color)


def main():
    # 每像素 3 字节；BG * (W*H) 一次展开成 bytes 再包进 bytearray
    px = bytearray(BG * (W * H))

    draw_glyph(px, BMP_B, MARGIN_X, MARGIN_Y, FG)
    draw_glyph(px, BMP_D, MARGIN_X + 5 * SCALE + GAP, MARGIN_Y, ACCENT)

    # PNG scanline：每行前置filter byte 0
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        raw += px[y * W * 3:(y + 1) * W * 3]

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))  # 8bit truecolor
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    out = os.path.join("public", "apple-touch-icon.png")
    os.makedirs("public", exist_ok=True)
    with open(out, "wb") as f:
        f.write(png)
    print(f"written: {out}  {len(png)} bytes  {W}x{H}")


if __name__ == "__main__":
    main()
