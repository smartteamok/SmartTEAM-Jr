#!/usr/bin/env python3
# Genera Program/STXConstants.js a partir de stx_isa.h y stx_proto.h.
# Fuente de verdad: los headers del firmware. Correr tras cualquier cambio:
#   python3 firmware/tools/gen_js_constants.py
import os
import re
import sys

MY_DIR = os.path.dirname(os.path.realpath(__file__))
FW_SRC = os.path.join(MY_DIR, "..", "source")
HEADERS = [
    os.path.join(FW_SRC, "vm", "stx_isa.h"),
    os.path.join(FW_SRC, "proto", "stx_proto.h"),
]
OUT_PATH = os.path.join(MY_DIR, "..", "..", "Program", "STXConstants.js")

DEFINE_RE = re.compile(
    r"^#define\s+(STX_[A-Z0-9_]+)\s+(0x[0-9A-Fa-f]+|\d+)\s*(?://\s*(.*))?$"
)


def parse_header(path):
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            m = DEFINE_RE.match(line.strip())
            if m:
                name, value, comment = m.group(1), m.group(2), m.group(3)
                entries.append((name, int(value, 0), (comment or "").strip()))
    return entries


def main():
    all_entries = []
    for header in HEADERS:
        entries = parse_header(header)
        if not entries:
            sys.exit("ERROR: no se encontraron #define STX_* en " + header)
        all_entries.append((os.path.basename(header), entries))

    lines = []
    lines.append('"use strict";')
    lines.append("")
    lines.append("/* STXConstants — GENERADO por firmware/tools/gen_js_constants.py.")
    lines.append(" * NO editar a mano: cambiar firmware/source/vm/stx_isa.h o")
    lines.append(" * firmware/source/proto/stx_proto.h y regenerar. */")
    lines.append("var STX = {};")
    for header_name, entries in all_entries:
        lines.append("")
        lines.append("/* ---- " + header_name + " ---- */")
        for name, value, comment in entries:
            js_name = name[len("STX_"):]
            hex_val = "0x%02X" % value if value <= 0xFF else "0x%X" % value
            suffix = "  // " + comment if comment else ""
            lines.append("STX." + js_name + " = " + hex_val + ";" + suffix)
    lines.append("")
    lines.append('if (typeof module !== "undefined" && module.exports) {')
    lines.append("  module.exports = STX;")
    lines.append("}")
    lines.append("")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    total = sum(len(e) for _, e in all_entries)
    print("OK: %d constantes -> %s" % (total, os.path.relpath(OUT_PATH, os.path.join(MY_DIR, "..", ".."))))


if __name__ == "__main__":
    main()
