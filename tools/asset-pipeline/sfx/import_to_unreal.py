"""Import generated SFX WAVs into an Unreal Engine 5 project as SoundWave assets.

Run inside the Unreal Editor (Python Editor Script Plugin enabled):
  - Output Log, Python mode:  py "<path>/import_to_unreal.py" --src "<wav dir>"
  - Or from UnrealClaude: execute_script with script_type "python" and this file's contents
    (edit SRC_DIR / DEST_PATH below first, since there are no command-line args there).

Re-running is safe: existing assets are replaced from the new WAVs (replace_existing).
"""

import argparse
import os
import sys

import unreal

# Defaults used when no arguments are passed (for example from execute_script).
SRC_DIR = ""  # absolute path to the folder generate-sfx.mjs wrote, e.g. C:/Game/assets/audio/sfx
DEST_PATH = "/Game/Audio/SFX"


def import_wavs(src_dir, dest_path):
    """Import every .wav in src_dir into dest_path. Returns the imported object paths."""
    wavs = sorted(
        os.path.join(src_dir, f) for f in os.listdir(src_dir) if f.lower().endswith(".wav")
    )
    if not wavs:
        unreal.log_warning("import_to_unreal: no .wav files in {}".format(src_dir))
        return []

    tasks = []
    for wav in wavs:
        task = unreal.AssetImportTask()
        task.filename = wav
        task.destination_path = dest_path
        task.automated = True
        task.replace_existing = True
        task.save = True
        tasks.append(task)

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)

    imported = []
    for task in tasks:
        imported.extend(task.imported_object_paths)
    unreal.log("import_to_unreal: imported {} of {} WAV(s) into {}".format(len(imported), len(wavs), dest_path))
    return imported


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", default=SRC_DIR, help="folder of WAVs to import")
    parser.add_argument("--dest", default=DEST_PATH, help="content path, e.g. /Game/Audio/SFX")
    args = parser.parse_args(argv)
    if not args.src or not os.path.isdir(args.src):
        unreal.log_error("import_to_unreal: --src must be an existing folder (got {!r})".format(args.src))
        return 1
    import_wavs(os.path.abspath(args.src), args.dest)
    return 0


if __name__ == "__main__":
    main(sys.argv[1:])
