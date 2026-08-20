from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC_CANDIDATES = [
    ROOT / "apps" / "desktop" / "build" / "icon-source.png",
    ROOT / "apps" / "desktop" / "build" / "icon.png",
    Path.home()
    / ".cursor"
    / "projects"
    / "d-project-404VPN"
    / "assets"
    / "404vpn-icon-1024.png",
]
RES = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "res"

SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def main() -> None:
    src = next((p for p in SRC_CANDIDATES if p.exists()), None)
    if src is None:
        raise SystemExit("logo source not found")
    print("source:", src)
    logo = Image.open(src).convert("RGBA")

    for folder, size in SIZES.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        icon = logo.resize((size, size), Image.Resampling.LANCZOS)
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            icon.save(out_dir / name, format="PNG")
        for old in ("ic_launcher.webp", "ic_launcher_round.webp"):
            p = out_dir / old
            if p.exists():
                p.unlink()
        print(f"{folder}: {size}px")

    # Adaptive foreground: 108dp * 4 = 432px, logo in ~66% safe zone
    fg_size = 432
    safe = int(fg_size * 0.72)
    fg = Image.new("RGBA", (fg_size, fg_size), (7, 11, 20, 255))
    logo_fit = logo.resize((safe, safe), Image.Resampling.LANCZOS)
    offset = (fg_size - safe) // 2
    fg.paste(logo_fit, (offset, offset), logo_fit)
    drawable = RES / "drawable"
    drawable.mkdir(parents=True, exist_ok=True)
    fg_path = drawable / "ic_launcher_foreground.png"
    fg.save(fg_path, format="PNG")
    print("foreground:", fg_path)


if __name__ == "__main__":
    main()
