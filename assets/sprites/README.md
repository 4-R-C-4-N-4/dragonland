# Sprite sheets

Drop `<unitId>.png` + `<unitId>.json` here (Aseprite "Export Sprite Sheet", JSON hash or array, frame tags `idle`, `walk`, `attack`, `hit`, `death`). The renderer picks them up by unit id (see `data/units.json`) and replaces that unit's placeholder shape. No code changes needed. Troops ~16-24 px tall, generals ~32-48 px. Missing tags fall back to `idle`.
