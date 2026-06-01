"""Generate SmartSCADA application icons with industrial theme."""

from PIL import Image, ImageDraw, ImageFont
import math
import struct
import io
import os


def draw_gear(draw: ImageDraw.ImageDraw, cx: int, cy: int, outer_r: int, inner_r: int, teeth: int, color: str, width: int = 2):
    """Draw a gear/cog shape centered at (cx, cy)."""
    points = []
    tooth_half = math.pi / teeth
    for i in range(teeth * 2):
        angle = (i * tooth_half) - math.pi / 2
        r = outer_r if i % 2 == 0 else inner_r
        points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(points, outline=color, fill=None)
    # Center hole
    hole_r = inner_r // 3
    draw.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], outline=color, width=width)


def draw_s_letter(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int, color: str):
    """Draw a stylized 'S' character."""
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", size)
    except (IOError, OSError):
        try:
            font = ImageFont.truetype("arial.ttf", size)
        except (IOError, OSError):
            font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "S", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = cx - tw // 2 - bbox[0]
    y = cy - th // 2 - bbox[1]
    draw.text((x, y), "S", fill=color, font=font)


def draw_circuit_pattern(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, color: str, width: int = 1):
    """Draw small circuit-like traces around the icon."""
    segments = [
        ((cx - radius, cy - radius + 4), (cx - radius + 12, cy - radius + 4)),
        ((cx + radius - 12, cy + radius - 4), (cx + radius, cy + radius - 4)),
        ((cx - radius + 4, cy + radius - 12), (cx - radius + 4, cy + radius)),
        ((cx + radius - 4, cy - radius), (cx + radius - 4, cy - radius + 12)),
    ]
    for start, end in segments:
        draw.line([start, end], fill=color, width=width)
    dot_r = 1
    for _, end in segments:
        draw.ellipse([end[0] - dot_r, end[1] - dot_r, end[0] + dot_r, end[1] + dot_r], fill=color)


def draw_gauge_arc(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, color: str, width: int = 2):
    """Draw a partial gauge arc (270 degrees) suggesting an instrument gauge."""
    bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
    draw.arc(bbox, start=135, end=405, fill=color, width=width)
    for angle_deg in [135, 180, 225, 270, 315, 360, 405]:
        angle = math.radians(angle_deg)
        x1 = cx + (radius - 4) * math.cos(angle)
        y1 = cy + (radius - 4) * math.sin(angle)
        x2 = cx + radius * math.cos(angle)
        y2 = cy + radius * math.sin(angle)
        draw.line([(x1, y1), (x2, y2)], fill=color, width=1)


def generate_icon(size: int) -> Image.Image:
    """Generate a SmartSCADA icon at the given size."""
    bg_color = "#1a1a2e"
    primary = "#409eff"
    primary_light = "#66b1ff"
    accent = "#79bbff"

    img = Image.new("RGBA", (size, size), bg_color)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    s = size / 256.0

    # Outer gear
    gear_outer = int(110 * s)
    gear_inner = int(95 * s)
    teeth = 16 if size >= 48 else 12
    draw_gear(draw, cx, cy, gear_outer, gear_inner, teeth, primary, width=max(1, int(2 * s)))

    # Inner circle
    inner_r = int(75 * s)
    draw.ellipse(
        [cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r],
        fill=bg_color, outline=primary, width=max(1, int(2 * s)),
    )

    # Circuit traces (larger sizes only)
    if size >= 48:
        draw_circuit_pattern(draw, cx, cy, int(118 * s), accent, width=max(1, int(1.5 * s)))

    # Gauge arc (larger sizes only)
    if size >= 48:
        draw_gauge_arc(draw, cx, cy, int(85 * s), primary_light, width=max(1, int(1.5 * s)))

    # Stylized "S"
    draw_s_letter(draw, cx, cy, int(80 * s), primary)

    # Orientation dot
    if size >= 32:
        dot_r = max(1, int(3 * s))
        draw.ellipse(
            [cx - dot_r, cy - gear_outer - dot_r - 2, cx + dot_r, cy - gear_outer + dot_r - 2],
            fill=primary_light,
        )

    return img


def save_multi_size_ico(images: list[Image.Image], path: str):
    """Save multiple PIL Images as a single multi-size ICO file using manual construction."""
    # ICO header: reserved(2) + type(2) + count(2)
    header = struct.pack("<HHH", 0, 1, len(images))
    dir_size = 6 + 16 * len(images)

    entries = []
    png_data_list = []
    offset = dir_size

    for img in images:
        w, h = img.size
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_data = buf.getvalue()
        png_data_list.append(png_data)

        entry = struct.pack(
            "<BBBBHHII",
            w if w < 256 else 0,   # width (0 means 256)
            h if h < 256 else 0,   # height (0 means 256)
            0,   # color count
            0,   # reserved
            1,   # color planes
            32,  # bits per pixel
            len(png_data),
            offset,
        )
        entries.append(entry)
        offset += len(png_data)

    with open(path, "wb") as f:
        f.write(header)
        for entry in entries:
            f.write(entry)
        for png_data in png_data_list:
            f.write(png_data)


def generate_app_icon(output_path: str):
    """Generate multi-size application icon (16, 32, 48, 256)."""
    sizes = [16, 32, 48, 256]
    images = [generate_icon(sz) for sz in sizes]
    save_multi_size_ico(images, output_path)
    print(f"  Created: {output_path} ({os.path.getsize(output_path):,} bytes)")
    print(f"  Embedded sizes: {sizes}")


def generate_tray_icon(output_path: str):
    """Generate 32x32 tray icon."""
    img = generate_icon(32)
    img.save(output_path, format="ICO")
    print(f"  Created: {output_path} ({os.path.getsize(output_path):,} bytes)")
    print(f"  Size: 32x32")


def main():
    res_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resources")
    os.makedirs(res_dir, exist_ok=True)

    print("Generating SmartSCADA icons...")
    print()

    generate_app_icon(os.path.join(res_dir, "icon.ico"))
    generate_tray_icon(os.path.join(res_dir, "tray-icon.ico"))

    print()
    print("Done. Both icons generated successfully.")


if __name__ == "__main__":
    main()
