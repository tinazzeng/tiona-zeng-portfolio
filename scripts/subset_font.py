#!/usr/bin/env python3
"""Create the conservatively renamed Sneaky Times web subset."""

from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/fonts/Sneaky Times 400.otf"
OUTPUT = ROOT / "assets/fonts/sneaky-times-latin.woff2"


def main() -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["liga", "clig", "kern"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    font = subset.load_font(str(SOURCE), options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=subset.parse_unicodes("U+0000-024F,U+2000-206F,U+20A0-20CF,U+2190-21FF,U+25A0-25FF"))
    subsetter.subset(font)
    subset.save_font(font, str(OUTPUT), options)

    renamed = TTFont(OUTPUT)
    names = renamed["name"]
    for record in list(names.names):
        if record.nameID in {1, 3, 4, 6}:
            names.removeNames(record.nameID)
    names.setName("Sneaky Times Web", 1, 3, 1, 0x409)
    names.setName("Sneaky Times Web Regular", 4, 3, 1, 0x409)
    names.setName("SneakyTimesWeb-Regular", 6, 3, 1, 0x409)
    names.setName("Sneaky Times Web; subset for tiona.studio", 3, 3, 1, 0x409)
    names.setName("Licensed under the SIL Open Font License 1.1", 13, 3, 1, 0x409)
    names.setName("https://openfontlicense.org/", 14, 3, 1, 0x409)
    renamed.save(OUTPUT)
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
