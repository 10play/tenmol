/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Regenerate with:
 *     python -m tenmol_bridge.panels.menus --ts apps/web/src/features/menubar/generated/menudata.ts
 *
 * Source of truth: packages/engine/modules/pymol/_gui.py:55 PyMOLDesktopGUI.get_menudata
 * The generator is packages/bridge/tenmol_bridge/panels/menus.py, which walks the real
 * upstream literal against a recording `cmd` proxy; packages/bridge/tests/test_menus.py
 * fails if this file drifts from it.
 */

import type { MenusPayload } from '@tenmol/protocol/topics/menus';

export const MENU_DATA: MenusPayload = {
  "schema": 1,
  "source": "packages/engine/modules/pymol/_gui.py:55 PyMOLDesktopGUI.get_menudata",
  "menus": [
    {
      "kind": "submenu",
      "label": "File",
      "items": [
        {
          "kind": "submenu",
          "label": "New PyMOL Window",
          "items": [
            {
              "kind": "command",
              "label": "Default",
              "action": {
                "type": "hook",
                "hook": "new_window",
                "args": [
                  []
                ]
              }
            },
            {
              "kind": "command",
              "label": "Ignore .pymolrc and plugins (-k)",
              "action": {
                "type": "hook",
                "hook": "new_window",
                "args": [
                  [
                    "-k"
                  ]
                ]
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Open...",
          "action": {
            "type": "hook",
            "hook": "file_open"
          }
        },
        {
          "kind": "dynamic",
          "label": "Open Recent...",
          "source": "open_recent"
        },
        {
          "kind": "command",
          "label": "Get PDB...",
          "action": {
            "type": "hook",
            "hook": "file_fetch_pdb"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Save Session",
          "action": {
            "type": "hook",
            "hook": "session_save"
          }
        },
        {
          "kind": "command",
          "label": "Save Session As...",
          "action": {
            "type": "hook",
            "hook": "session_save_as"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Export Molecule...",
          "action": {
            "type": "hook",
            "hook": "file_save"
          }
        },
        {
          "kind": "command",
          "label": "Export Map...",
          "action": {
            "type": "hook",
            "hook": "file_save_map"
          }
        },
        {
          "kind": "command",
          "label": "Export Alignment...",
          "action": {
            "type": "hook",
            "hook": "file_save_aln"
          }
        },
        {
          "kind": "submenu",
          "label": "Export Image As",
          "items": [
            {
              "kind": "command",
              "label": "PNG...",
              "action": {
                "type": "hook",
                "hook": "file_save_png"
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "VRML 2...",
              "action": {
                "type": "hook",
                "hook": "file_save_wrl"
              }
            },
            {
              "kind": "command",
              "label": "COLLADA...",
              "action": {
                "type": "hook",
                "hook": "file_save_dae"
              }
            },
            {
              "kind": "command",
              "label": "GLTF...",
              "action": {
                "type": "hook",
                "hook": "file_save_gltf"
              }
            },
            {
              "kind": "command",
              "label": "POV-Ray...",
              "action": {
                "type": "hook",
                "hook": "file_save_pov"
              }
            },
            {
              "kind": "command",
              "label": "STL...",
              "action": {
                "type": "hook",
                "hook": "file_save_stl"
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Export Movie As",
          "items": [
            {
              "kind": "command",
              "label": "MPEG...",
              "action": {
                "type": "hook",
                "hook": "file_save_mpeg"
              }
            },
            {
              "kind": "command",
              "label": "Quicktime...",
              "action": {
                "type": "hook",
                "hook": "file_save_mov"
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "PNG Images...",
              "action": {
                "type": "hook",
                "hook": "file_save_mpng"
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Log File",
          "items": [
            {
              "kind": "command",
              "label": "Open...",
              "action": {
                "type": "hook",
                "hook": "log_open"
              }
            },
            {
              "kind": "command",
              "label": "Resume...",
              "action": {
                "type": "hook",
                "hook": "log_resume"
              }
            },
            {
              "kind": "command",
              "label": "Append...",
              "action": {
                "type": "hook",
                "hook": "log_append"
              }
            },
            {
              "kind": "command",
              "label": "Close",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.log_close",
                    "args": [],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "command",
          "label": "Run Script...",
          "action": {
            "type": "hook",
            "hook": "file_run"
          }
        },
        {
          "kind": "submenu",
          "label": "Working Directory",
          "items": [
            {
              "kind": "command",
              "label": "Change...",
              "action": {
                "type": "hook",
                "hook": "cd_dialog"
              }
            },
            {
              "kind": "command",
              "label": "File Browser",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.system",
                    "args": [
                      "open ."
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Edit pymolrc",
          "action": {
            "type": "hook",
            "hook": "edit_pymolrc"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Reinitialize",
          "items": [
            {
              "kind": "command",
              "label": "Everything",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.reinitialize",
                    "args": [],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Original Settings",
              "action": {
                "type": "do",
                "command": "reinitialize original_settings"
              }
            },
            {
              "kind": "command",
              "label": "Stored Settings",
              "action": {
                "type": "do",
                "command": "reinitialize settings"
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "Store Current Settings",
              "action": {
                "type": "do",
                "command": "reinitialize store_defaults"
              }
            }
          ]
        },
        {
          "kind": "command",
          "label": "Quit",
          "action": {
            "type": "hook",
            "hook": "confirm_quit"
          }
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Edit",
      "items": [
        {
          "kind": "command",
          "label": "Undo [Ctrl-Z]",
          "accel": "Ctrl-Z",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.undo",
                "args": [],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "Redo [Ctrl-Y]",
          "accel": "Ctrl-Y",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.redo",
                "args": [],
                "kwargs": {}
              }
            ]
          }
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Build",
      "items": [
        {
          "kind": "submenu",
          "label": "Fragment",
          "items": [
            {
              "kind": "command",
              "label": "Acetylene [Alt-J]",
              "accel": "Alt-J",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','acetylene',2,0)"
              }
            },
            {
              "kind": "command",
              "label": "Amide N->C [Alt-1]",
              "accel": "Alt-1",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','formamide',3,1)"
              }
            },
            {
              "kind": "command",
              "label": "Amide C->N [Alt-2]",
              "accel": "Alt-2",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','formamide',5,0)"
              }
            },
            {
              "kind": "command",
              "label": "Bromine [Ctrl-Shift-B]",
              "accel": "Ctrl-Shift-B",
              "action": {
                "type": "do",
                "command": "replace Br,1,1"
              }
            },
            {
              "kind": "command",
              "label": "Carbon [Ctrl-Shift-C]",
              "accel": "Ctrl-Shift-C",
              "action": {
                "type": "do",
                "command": "replace C,4,4"
              }
            },
            {
              "kind": "command",
              "label": "Carbonyl [Alt-0]",
              "accel": "Alt-0",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','formaldehyde',2,0)"
              }
            },
            {
              "kind": "command",
              "label": "Chlorine [Ctrl-Shift-L]",
              "accel": "Ctrl-Shift-L",
              "action": {
                "type": "do",
                "command": "replace Cl,1,1"
              }
            },
            {
              "kind": "command",
              "label": "Cyclobutyl [Alt-4]",
              "accel": "Alt-4",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','cyclobutane',4,0)"
              }
            },
            {
              "kind": "command",
              "label": "Cyclopentyl [Alt-5]",
              "accel": "Alt-5",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','cyclopentane',5,0)"
              }
            },
            {
              "kind": "command",
              "label": "Cyclopentadiene [Alt-8]",
              "accel": "Alt-8",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','cyclopentadiene',5,0)"
              }
            },
            {
              "kind": "command",
              "label": "Cyclohexyl [Alt-6]",
              "accel": "Alt-6",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','cyclohexane',7,0)"
              }
            },
            {
              "kind": "command",
              "label": "Cycloheptyl [Alt-7]",
              "accel": "Alt-7",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','cycloheptane',8,0)"
              }
            },
            {
              "kind": "command",
              "label": "Fluorine [Ctrl-Shift-F]",
              "accel": "Ctrl-Shift-F",
              "action": {
                "type": "do",
                "command": "replace F,1,1"
              }
            },
            {
              "kind": "command",
              "label": "Iodine [Ctrl-Shift-I]",
              "accel": "Ctrl-Shift-I",
              "action": {
                "type": "do",
                "command": "replace I,1,1"
              }
            },
            {
              "kind": "command",
              "label": "Methane [Ctrl-Shift-M]",
              "accel": "Ctrl-Shift-M",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','methane',1,0)"
              }
            },
            {
              "kind": "command",
              "label": "Nitrogen [Ctrl-Shift-N]",
              "accel": "Ctrl-Shift-N",
              "action": {
                "type": "do",
                "command": "replace N,4,3"
              }
            },
            {
              "kind": "command",
              "label": "Oxygen [Ctrl-Shift-O]",
              "accel": "Ctrl-Shift-O",
              "action": {
                "type": "do",
                "command": "replace O,4,2"
              }
            },
            {
              "kind": "command",
              "label": "Sulfer [Ctrl-Shift-S]",
              "accel": "Ctrl-Shift-S",
              "action": {
                "type": "do",
                "command": "replace S,2,2"
              }
            },
            {
              "kind": "command",
              "label": "Sulfonyl [Alt-3]",
              "accel": "Alt-3",
              "action": {
                "type": "do",
                "command": "editor.attach_fragment('pk1','sulfone',3,1)"
              }
            },
            {
              "kind": "command",
              "label": "Phosphorus [Ctrl-Shift-P]",
              "accel": "Ctrl-Shift-P",
              "action": {
                "type": "do",
                "command": "replace P,4,3"
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Residue",
          "items": [
            {
              "kind": "command",
              "label": "Acetyl [Alt-B]",
              "accel": "Alt-B",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "ace"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Alanine [Alt-A]",
              "accel": "Alt-A",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "ala"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Amine",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "nhh"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Aspartate [Alt-D]",
              "accel": "Alt-D",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "asp"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Asparagine [Alt-N]",
              "accel": "Alt-N",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "asn"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Arginine [Alt-R]",
              "accel": "Alt-R",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "arg"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Cysteine [Alt-C]",
              "accel": "Alt-C",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "cys"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Glutamate [Alt-E]",
              "accel": "Alt-E",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "glu"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Glutamine [Alt-Q]",
              "accel": "Alt-Q",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "gln"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Glycine [Alt-G]",
              "accel": "Alt-G",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "gly"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Histidine [Alt-H]",
              "accel": "Alt-H",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "his"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Isoleucine [Alt-I]",
              "accel": "Alt-I",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "ile"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Leucine [Alt-L]",
              "accel": "Alt-L",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "leu"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Lysine [Alt-K]",
              "accel": "Alt-K",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "lys"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Methionine [Alt-M]",
              "accel": "Alt-M",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "met"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "N-Methyl [Alt-Z]",
              "accel": "Alt-Z",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "nme"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Phenylalanine [Alt-F]",
              "accel": "Alt-F",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "phe"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Proline [Alt-P]",
              "accel": "Alt-P",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "pro"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Serine [Alt-S]",
              "accel": "Alt-S",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "ser"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Threonine [Alt-T]",
              "accel": "Alt-T",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "thr"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Tryptophan [Alt-W]",
              "accel": "Alt-W",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "trp"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Tyrosine [Alt-Y]",
              "accel": "Alt-Y",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "tyr"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Valine [Alt-V]",
              "accel": "Alt-V",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.editor.attach_amino_acid",
                    "args": [
                      "pk1",
                      "val"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "Helix",
              "setting": "secondary_structure",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Antiparallel Beta Sheet",
              "setting": "secondary_structure",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "Parallel Beta Sheet",
              "setting": "secondary_structure",
              "value": 3
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Sculpting",
          "items": [
            {
              "kind": "check",
              "label": "Auto-Sculpting",
              "setting": "auto_sculpt",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Sculpting",
              "setting": "sculpting",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "Activate",
              "action": {
                "type": "do",
                "command": "sculpt_activate all"
              }
            },
            {
              "kind": "command",
              "label": "Deactivate",
              "action": {
                "type": "do",
                "command": "sculpt_deactivate all"
              }
            },
            {
              "kind": "command",
              "label": "Clear Memory",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.sculpt_purge",
                    "args": [],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "1 Cycle per Update",
              "setting": "sculpting_cycles",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "3 Cycles per Update",
              "setting": "sculpting_cycles",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "10 Cycles per Update",
              "setting": "sculpting_cycles",
              "value": 10
            },
            {
              "kind": "radio",
              "label": "33 Cycles per Update",
              "setting": "sculpting_cycles",
              "value": 33
            },
            {
              "kind": "radio",
              "label": "100 Cycles per Update",
              "setting": "sculpting_cycles",
              "value": 100
            },
            {
              "kind": "radio",
              "label": "333 Cycles per Update",
              "setting": "sculpting_cycles",
              "value": 333
            },
            {
              "kind": "radio",
              "label": "1000 Cycles per Update",
              "setting": "sculpting_cycles",
              "value": 1000
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "Bonds Only",
              "setting": "sculpt_field_mask",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Bonds and Angles Only",
              "setting": "sculpt_field_mask",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "Local Geometry Only",
              "setting": "sculpt_field_mask",
              "value": 31
            },
            {
              "kind": "radio",
              "label": "All Except VDW",
              "setting": "sculpt_field_mask",
              "value": -97
            },
            {
              "kind": "radio",
              "label": "All Except 1-4 VDW and Torsions",
              "setting": "sculpt_field_mask",
              "value": -193
            },
            {
              "kind": "radio",
              "label": "All Terms",
              "setting": "sculpt_field_mask",
              "value": 255
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Cycle Bond Valence [Ctrl-Shift-W]",
          "accel": "Ctrl-Shift-W",
          "action": {
            "type": "do",
            "command": "cycle_valence"
          }
        },
        {
          "kind": "command",
          "label": "Fill Hydrogens on (pk1) [Ctrl-Shift-R]",
          "accel": "Ctrl-Shift-R",
          "action": {
            "type": "do",
            "command": "h_fill"
          }
        },
        {
          "kind": "command",
          "label": "Invert (pk2)-(pk1)-(pk3) [Ctrl-Shift-E]",
          "accel": "Ctrl-Shift-E",
          "action": {
            "type": "do",
            "command": "invert"
          }
        },
        {
          "kind": "command",
          "label": "Create Bond (pk1)-(pk2) [Ctrl-Shift-T]",
          "accel": "Ctrl-Shift-T",
          "action": {
            "type": "do",
            "command": "bond"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Remove (pk1) [Ctrl-Shift-D]",
          "accel": "Ctrl-Shift-D",
          "action": {
            "type": "do",
            "command": "remove pk1"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Make (pk1) Positive [Ctrl-Shift-K]",
          "accel": "Ctrl-Shift-K",
          "action": {
            "type": "do",
            "command": "alter pk1, formal_charge=1"
          }
        },
        {
          "kind": "command",
          "label": "Make (pk1) Negative [Ctrl-Shift-J]",
          "accel": "Ctrl-Shift-J",
          "action": {
            "type": "do",
            "command": "alter pk1, formal_charge=-1"
          }
        },
        {
          "kind": "command",
          "label": "Make (pk1) Neutral [Ctrl-Shift-U]",
          "accel": "Ctrl-Shift-U",
          "action": {
            "type": "do",
            "command": "alter pk1, formal_charge=0"
          }
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Movie",
      "items": [
        {
          "kind": "submenu",
          "label": "Append",
          "items": [
            {
              "kind": "command",
              "label": "0.25 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      0.25
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "0.5 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      0.5
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "1 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      1
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "2 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      2
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "3 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      3
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "4 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      4
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "6 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      6
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "8 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      8
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "12 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      12
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "18 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      18
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "24 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      24
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "30 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      30
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "48 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      48
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "60 second",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.movie.add_blank",
                    "args": [
                      60
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Program",
          "items": [
            {
              "kind": "submenu",
              "label": "Camera Loop",
              "items": [
                {
                  "kind": "submenu",
                  "label": "Nutate",
                  "items": [
                    {
                      "kind": "command",
                      "label": "15 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(4,15,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "15 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(8,15,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "15 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(12,15,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(4,30,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(8,30,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(12,30,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(16,30,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(8,60,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(16,60,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(24,60,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 32 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_nutate(32,60,start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "separator"
                },
                {
                  "kind": "submenu",
                  "label": "X-Rock",
                  "items": [
                    {
                      "kind": "command",
                      "label": "30 deg. over 2 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(2,30,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(4,30,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(8,30,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(4,60,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(8,60,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(16,60,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 6 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(6,90,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(12,90,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(24,90,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(8,120,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(16,120,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 32 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(32,120,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "180 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(12,179.99,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "180 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(24,179.99,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "180 deg. over 48 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(48,179.99,axis='x',start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "X-Roll",
                  "items": [
                    {
                      "kind": "command",
                      "label": "4 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(4.0,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "8 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(8.0,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "16 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(16.0,axis='x',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "32 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(32.0,axis='x',start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "separator"
                },
                {
                  "kind": "submenu",
                  "label": "Y-Rock",
                  "items": [
                    {
                      "kind": "command",
                      "label": "30 deg. over 2 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(2,30,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(4,30,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(8,30,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(4,60,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(8,60,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(16,60,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 6 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(6,90,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(12,90,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(24,90,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(8,120,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(16,120,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 32 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(32,120,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "separator"
                    },
                    {
                      "kind": "command",
                      "label": "180 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(12,179.99,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "180 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(24,179.99,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "180 deg. over 48 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_rock(48,179.99,axis='y',start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "Y-Roll",
                  "items": [
                    {
                      "kind": "command",
                      "label": "4 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(4.0,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "8 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(8.0,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "16 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(16.0,axis='y',start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "32 seconds",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_roll(32.0,axis='y',start=%d)"
                        ]
                      }
                    }
                  ]
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "submenu",
              "label": "Scene Loop",
              "items": [
                {
                  "kind": "submenu",
                  "label": "Nutate",
                  "items": [
                    {
                      "kind": "command",
                      "label": "30 deg. over 2 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 4, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 8, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 4, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 8, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 16, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 6 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 6, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 12, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 24, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 8, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 16, rock=4, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 32 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 32, rock=4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "X-Rock",
                  "items": [
                    {
                      "kind": "command",
                      "label": "30 deg. over 2 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 4, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 8, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 4, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 8, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 16, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 6 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 6, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 12, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 24, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 8, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 16, rock=2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 32 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 32, rock=2, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "Y-Rock",
                  "items": [
                    {
                      "kind": "command",
                      "label": "30 deg. over 2 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 2, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 4, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "30 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,30;cmd.movie.add_scenes(None, 8, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 4 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 4, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 8, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "60 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,60;cmd.movie.add_scenes(None, 16, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 6 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 6, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 12 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 12, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "90 deg. over 24 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,90;cmd.movie.add_scenes(None, 24, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 8 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 8, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 16 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 16, rock=1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "120 deg. over 32 sec.",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "set sweep_angle,120;cmd.movie.add_scenes(None, 32, rock=1, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "Steady",
                  "items": [
                    {
                      "kind": "command",
                      "label": "1 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,1.0,rock=0,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,2.0,rock=0,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,4.0,rock=0,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "8 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,8.0,rock=0,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "12 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,12.0,rock=0,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "16 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,16.0,rock=0,start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "24 seconds each",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_scenes(None,24.0,rock=0,start=%d)"
                        ]
                      }
                    }
                  ]
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "submenu",
              "label": "State Loop",
              "items": [
                {
                  "kind": "submenu",
                  "label": "Full Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(1, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(1, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(1, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(1, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/2 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(2, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(2, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(2, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(2, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/3 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(3, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(3, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(3, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(3, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/4 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(4, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(4, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(4, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(4, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/8 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(8, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(8, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(8, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(8, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/16 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(16, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(16, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(16, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_loop(16, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "State Sweep",
              "items": [
                {
                  "kind": "submenu",
                  "label": "Full Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(1, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(1, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(1, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(1, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/2 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(2, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(2, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(2, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(2, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/3 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(3, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(3, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(3, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(3, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/4 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(4, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(4, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(4, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(4, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/8 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(8, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(8, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(8, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(8, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                },
                {
                  "kind": "submenu",
                  "label": "1/16 Speed",
                  "items": [
                    {
                      "kind": "command",
                      "label": "no pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(16, 0, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "1 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(16, 1, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "2 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(16, 2, start=%d)"
                        ]
                      }
                    },
                    {
                      "kind": "command",
                      "label": "4 second pause",
                      "action": {
                        "type": "hook",
                        "hook": "mvprg",
                        "args": [
                          "movie.add_state_sweep(16, 4, start=%d)"
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "kind": "command",
          "label": "Update Last Program",
          "action": {
            "type": "hook",
            "hook": "mvprg",
            "args": [
              null
            ]
          }
        },
        {
          "kind": "command",
          "label": "Remove Last Program",
          "action": {
            "type": "hook",
            "hook": "mvprg_remove_last"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Reset",
          "action": {
            "type": "do",
            "command": "mset;rewind"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Frame Rate",
          "items": [
            {
              "kind": "radio",
              "label": "30 FPS",
              "setting": "movie_fps",
              "value": 30.0
            },
            {
              "kind": "radio",
              "label": "15 FPS",
              "setting": "movie_fps",
              "value": 15.0
            },
            {
              "kind": "radio",
              "label": "5 FPS",
              "setting": "movie_fps",
              "value": 5.0
            },
            {
              "kind": "radio",
              "label": "1 FPS",
              "setting": "movie_fps",
              "value": 1.0
            },
            {
              "kind": "radio",
              "label": "0.3 FPS",
              "setting": "movie_fps",
              "value": 0.3
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Show Frame Rate",
              "setting": "show_frame_rate",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "command",
              "label": "Reset Meter",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.meter_reset",
                    "args": [],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Auto Interpolate",
          "setting": "movie_auto_interpolate",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Show Panel",
          "setting": "movie_panel",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Loop Frames",
          "setting": "movie_loop",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Draw Frames",
          "setting": "draw_frames",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Ray Trace Frames",
          "setting": "ray_trace_frames",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Cache Frame Images",
          "setting": "cache_frames",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "command",
          "label": "Clear Image Cache",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.mclear",
                "args": [],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Static Singletons",
          "setting": "static_singletons",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Show All States",
          "setting": "all_states",
          "trueValue": 1,
          "falseValue": 0
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Display",
      "items": [
        {
          "kind": "check",
          "label": "Sequence",
          "setting": "seq_view",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "submenu",
          "label": "Sequence Mode",
          "items": [
            {
              "kind": "radio",
              "label": "Residue Codes",
              "setting": "seq_view_format",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "Residue Names",
              "setting": "seq_view_format",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Chain Identifiers",
              "setting": "seq_view_format",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "Atom Names",
              "setting": "seq_view_format",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "States",
              "setting": "seq_view_format",
              "value": 4
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "All Residue Numbers",
              "setting": "seq_view_label_mode",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "Top Sequence Only",
              "setting": "seq_view_label_mode",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Object Names Only",
              "setting": "seq_view_label_mode",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "No Labels",
              "setting": "seq_view_label_mode",
              "value": 3
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "No Gaps",
              "setting": "seq_view_gap_mode",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "All Gaps",
              "setting": "seq_view_gap_mode",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Single Gap",
              "setting": "seq_view_gap_mode",
              "value": 2
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Internal GUI",
          "setting": "internal_gui",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Internal Prompt",
          "setting": "internal_prompt",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "submenu",
          "label": "Internal Feedback",
          "items": [
            {
              "kind": "radio",
              "label": "0",
              "setting": "internal_feedback",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "1",
              "setting": "internal_feedback",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "3",
              "setting": "internal_feedback",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "5",
              "setting": "internal_feedback",
              "value": 5
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Overlay",
          "items": [
            {
              "kind": "radio",
              "label": "0",
              "setting": "overlay",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "1",
              "setting": "overlay",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "3",
              "setting": "overlay",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "5",
              "setting": "overlay",
              "value": 5
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Stereo",
          "setting": "stereo",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "submenu",
          "label": "Stereo Mode",
          "items": [
            {
              "kind": "command",
              "label": "Anaglyph Stereo",
              "action": {
                "type": "do",
                "command": "stereo anaglyph"
              }
            },
            {
              "kind": "command",
              "label": "Cross-Eye Stereo",
              "action": {
                "type": "do",
                "command": "stereo crosseye"
              }
            },
            {
              "kind": "command",
              "label": "Wall-Eye Stereo",
              "action": {
                "type": "do",
                "command": "stereo walleye"
              }
            },
            {
              "kind": "command",
              "label": "Quad-Buffered Stereo",
              "action": {
                "type": "do",
                "command": "stereo quadbuffer"
              }
            },
            {
              "kind": "command",
              "label": "Zalman Stereo",
              "action": {
                "type": "do",
                "command": "stereo byrow"
              }
            },
            {
              "kind": "command",
              "label": "OpenVR",
              "action": {
                "type": "do",
                "command": "stereo openvr"
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "Swap Sides",
              "action": {
                "type": "do",
                "command": "stereo swap"
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "Chromadepth",
              "action": {
                "type": "do",
                "command": "stereo chromadepth"
              }
            },
            {
              "kind": "command",
              "label": "off",
              "action": {
                "type": "do",
                "command": "stereo off"
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Zoom",
          "items": [
            {
              "kind": "command",
              "label": "4 Angstrom Sphere",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.zoom",
                    "args": [
                      "center",
                      4
                    ],
                    "kwargs": {
                      "animate": -1
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "6 Angstrom Sphere",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.zoom",
                    "args": [
                      "center",
                      6
                    ],
                    "kwargs": {
                      "animate": -1
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "8 Angstrom Sphere",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.zoom",
                    "args": [
                      "center",
                      8
                    ],
                    "kwargs": {
                      "animate": -1
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "12 Angstrom Sphere",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.zoom",
                    "args": [
                      "center",
                      12
                    ],
                    "kwargs": {
                      "animate": -1
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "20 Angstrom Sphere",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.zoom",
                    "args": [
                      "center",
                      20
                    ],
                    "kwargs": {
                      "animate": -1
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "All",
              "action": {
                "type": "do",
                "command": "zoom animate=-1"
              }
            },
            {
              "kind": "command",
              "label": "Complete",
              "action": {
                "type": "do",
                "command": "zoom animate=-1, complete=1"
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Clip",
          "items": [
            {
              "kind": "command",
              "label": "Nothing",
              "action": {
                "type": "do",
                "command": "clip atoms, 5, all"
              }
            },
            {
              "kind": "command",
              "label": "8 Angstrom Slab",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.clip",
                    "args": [
                      "slab",
                      8
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "12 Angstrom Slab",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.clip",
                    "args": [
                      "slab",
                      12
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "16 Angstrom Slab",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.clip",
                    "args": [
                      "slab",
                      16
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "20 Angstrom Slab",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.clip",
                    "args": [
                      "slab",
                      20
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "30 Angstrom Slab",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.clip",
                    "args": [
                      "slab",
                      30
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Background",
          "items": [
            {
              "kind": "check",
              "label": "Opaque",
              "setting": "opaque_background",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Alpha Checker",
              "setting": "show_alpha_checker",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "White",
              "setting": "bg_rgb",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "Light Grey",
              "setting": "bg_rgb",
              "value": 134
            },
            {
              "kind": "radio",
              "label": "Grey",
              "setting": "bg_rgb",
              "value": 104
            },
            {
              "kind": "radio",
              "label": "Black",
              "setting": "bg_rgb",
              "value": 1
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Color Space",
          "items": [
            {
              "kind": "command",
              "label": "CMYK (for publications)",
              "action": {
                "type": "do",
                "command": "space cmyk"
              }
            },
            {
              "kind": "command",
              "label": "PyMOL (for video + web)",
              "action": {
                "type": "do",
                "command": "space pymol"
              }
            },
            {
              "kind": "command",
              "label": "RGB (default)",
              "action": {
                "type": "do",
                "command": "space rgb"
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Quality",
          "items": [
            {
              "kind": "command",
              "label": "Maximum Performance",
              "action": {
                "type": "do",
                "command": "util.performance(100)"
              }
            },
            {
              "kind": "command",
              "label": "Reasonable Performance",
              "action": {
                "type": "do",
                "command": "util.performance(66)"
              }
            },
            {
              "kind": "command",
              "label": "Reasonable Quality",
              "action": {
                "type": "do",
                "command": "util.performance(33)"
              }
            },
            {
              "kind": "command",
              "label": "Maximum Quality",
              "action": {
                "type": "do",
                "command": "util.performance(0)"
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Grid",
          "items": [
            {
              "kind": "radio",
              "label": "By Object",
              "setting": "grid_mode",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "By State",
              "setting": "grid_mode",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "By Object-State",
              "setting": "grid_mode",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "Disable",
              "setting": "grid_mode",
              "value": 0
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Orthoscopic View",
          "setting": "orthoscopic",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Show Valences",
          "setting": "valence",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Smooth Lines",
          "setting": "line_smooth",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Depth Cue (Fogging)",
          "setting": "depth_cue",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Two Sided Lighting",
          "setting": "two_sided_lighting",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Specular Reflections",
          "setting": "specular",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Animation",
          "setting": "animation",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Roving Detail",
          "setting": "roving_detail",
          "trueValue": 1,
          "falseValue": 0
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Setting",
      "items": [
        {
          "kind": "command",
          "label": "Edit All...",
          "action": {
            "type": "hook",
            "hook": "settings_edit_all_dialog"
          }
        },
        {
          "kind": "command",
          "label": "Keyboard Shortcuts...",
          "action": {
            "type": "hook",
            "hook": "shortcut_menu_edit_dialog"
          }
        },
        {
          "kind": "command",
          "label": "Colors...",
          "action": {
            "type": "hook",
            "hook": "edit_colors_dialog"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Label",
          "items": [
            {
              "kind": "submenu",
              "label": "Size",
              "items": [
                {
                  "kind": "radio",
                  "label": "10 Point",
                  "setting": "label_size",
                  "value": 10
                },
                {
                  "kind": "radio",
                  "label": "14 Point",
                  "setting": "label_size",
                  "value": 14
                },
                {
                  "kind": "radio",
                  "label": "18 Point",
                  "setting": "label_size",
                  "value": 18
                },
                {
                  "kind": "radio",
                  "label": "24 Point",
                  "setting": "label_size",
                  "value": 24
                },
                {
                  "kind": "radio",
                  "label": "36 Point",
                  "setting": "label_size",
                  "value": 36
                },
                {
                  "kind": "radio",
                  "label": "48 Point",
                  "setting": "label_size",
                  "value": 48
                },
                {
                  "kind": "radio",
                  "label": "72 Point",
                  "setting": "label_size",
                  "value": 72
                },
                {
                  "kind": "separator"
                },
                {
                  "kind": "radio",
                  "label": "0.3 Angstrom",
                  "setting": "label_size",
                  "value": -0.3
                },
                {
                  "kind": "radio",
                  "label": "0.5 Angstrom",
                  "setting": "label_size",
                  "value": -0.5
                },
                {
                  "kind": "radio",
                  "label": "1 Angstrom",
                  "setting": "label_size",
                  "value": -1
                },
                {
                  "kind": "radio",
                  "label": "2 Angstrom",
                  "setting": "label_size",
                  "value": -2
                },
                {
                  "kind": "radio",
                  "label": "4 Angstrom",
                  "setting": "label_size",
                  "value": -4
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Font",
              "items": [
                {
                  "kind": "radio",
                  "label": "Sans",
                  "setting": "label_font_id",
                  "value": 5
                },
                {
                  "kind": "radio",
                  "label": "Sans Oblique",
                  "setting": "label_font_id",
                  "value": 6
                },
                {
                  "kind": "radio",
                  "label": "Sans Bold",
                  "setting": "label_font_id",
                  "value": 7
                },
                {
                  "kind": "radio",
                  "label": "Sans Bold Oblique",
                  "setting": "label_font_id",
                  "value": 8
                },
                {
                  "kind": "radio",
                  "label": "Serif",
                  "setting": "label_font_id",
                  "value": 9
                },
                {
                  "kind": "radio",
                  "label": "Serif Oblique",
                  "setting": "label_font_id",
                  "value": 17
                },
                {
                  "kind": "radio",
                  "label": "Serif Bold",
                  "setting": "label_font_id",
                  "value": 10
                },
                {
                  "kind": "radio",
                  "label": "Serif Bold Oblique",
                  "setting": "label_font_id",
                  "value": 18
                },
                {
                  "kind": "radio",
                  "label": "Mono",
                  "setting": "label_font_id",
                  "value": 11
                },
                {
                  "kind": "radio",
                  "label": "Mono Oblique",
                  "setting": "label_font_id",
                  "value": 12
                },
                {
                  "kind": "radio",
                  "label": "Mono Bold",
                  "setting": "label_font_id",
                  "value": 13
                },
                {
                  "kind": "radio",
                  "label": "Mono Bold Oblique",
                  "setting": "label_font_id",
                  "value": 14
                },
                {
                  "kind": "radio",
                  "label": "Gentium Roman",
                  "setting": "label_font_id",
                  "value": 15
                },
                {
                  "kind": "radio",
                  "label": "Gentium Italic",
                  "setting": "label_font_id",
                  "value": 16
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Color",
              "items": [
                {
                  "kind": "radio",
                  "label": "Front",
                  "setting": "label_color",
                  "value": -6
                },
                {
                  "kind": "radio",
                  "label": "Back",
                  "setting": "label_color",
                  "value": -7
                }
              ]
            },
            {
              "kind": "check",
              "label": "Show Connectors",
              "setting": "label_connector",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "submenu",
              "label": "Background Color",
              "items": [
                {
                  "kind": "radio",
                  "label": "None",
                  "setting": "label_bg_color",
                  "value": -1
                },
                {
                  "kind": "radio",
                  "label": "Back",
                  "setting": "label_bg_color",
                  "value": -7
                },
                {
                  "kind": "radio",
                  "label": "Front",
                  "setting": "label_bg_color",
                  "value": -6
                }
              ]
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Lines & Sticks",
          "items": [
            {
              "kind": "check",
              "label": "Ball and Stick",
              "setting": "stick_ball",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "submenu",
              "label": "Ball and Stick Ratio",
              "items": [
                {
                  "kind": "radio",
                  "label": "1.0",
                  "setting": "stick_ball_ratio",
                  "value": 1.0
                },
                {
                  "kind": "radio",
                  "label": "1.5",
                  "setting": "stick_ball_ratio",
                  "value": 1.5
                },
                {
                  "kind": "radio",
                  "label": "VDW",
                  "setting": "stick_ball_ratio",
                  "value": -1.0
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "submenu",
              "label": "Zero Order Bonds",
              "items": [
                {
                  "kind": "radio",
                  "label": "Hide",
                  "setting": "valence_zero_mode",
                  "value": 0
                },
                {
                  "kind": "radio",
                  "label": "Dashed",
                  "setting": "valence_zero_mode",
                  "value": 1
                },
                {
                  "kind": "radio",
                  "label": "Solid",
                  "setting": "valence_zero_mode",
                  "value": 2
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Zero Order Stick Scale",
              "items": [
                {
                  "kind": "radio",
                  "label": "0.1",
                  "setting": "valence_zero_scale",
                  "value": 0.1
                },
                {
                  "kind": "radio",
                  "label": "0.2",
                  "setting": "valence_zero_scale",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "0.3",
                  "setting": "valence_zero_scale",
                  "value": 0.3
                },
                {
                  "kind": "radio",
                  "label": "1.0",
                  "setting": "valence_zero_scale",
                  "value": 1.0
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "submenu",
              "label": "Stick Radius",
              "items": [
                {
                  "kind": "radio",
                  "label": "0.1",
                  "setting": "stick_radius",
                  "value": 0.1
                },
                {
                  "kind": "radio",
                  "label": "0.2",
                  "setting": "stick_radius",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "0.25",
                  "setting": "stick_radius",
                  "value": 0.25
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Stick Hydrogen Scale",
              "items": [
                {
                  "kind": "radio",
                  "label": "0.4",
                  "setting": "stick_h_scale",
                  "value": 0.4
                },
                {
                  "kind": "radio",
                  "label": "1.0",
                  "setting": "stick_h_scale",
                  "value": 1.0
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "submenu",
              "label": "Line Width",
              "items": [
                {
                  "kind": "radio",
                  "label": "1.0",
                  "setting": "line_width",
                  "value": 1.0
                },
                {
                  "kind": "radio",
                  "label": "1.49",
                  "setting": "line_width",
                  "value": 1.49
                },
                {
                  "kind": "radio",
                  "label": "3.0",
                  "setting": "line_width",
                  "value": 3.0
                }
              ]
            },
            {
              "kind": "check",
              "label": "Lines As Cylinders",
              "setting": "line_as_cylinders",
              "trueValue": 1,
              "falseValue": 0
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Cartoon",
          "items": [
            {
              "kind": "submenu",
              "label": "Rings and Bases",
              "items": [
                {
                  "kind": "radio",
                  "label": "Filled Rings (Round Edges)",
                  "setting": "cartoon_ring_mode",
                  "value": 1
                },
                {
                  "kind": "radio",
                  "label": "Filled Rings (Flat Edges)",
                  "setting": "cartoon_ring_mode",
                  "value": 2
                },
                {
                  "kind": "radio",
                  "label": "Filled Rings (with Border)",
                  "setting": "cartoon_ring_mode",
                  "value": 3
                },
                {
                  "kind": "radio",
                  "label": "Spheres",
                  "setting": "cartoon_ring_mode",
                  "value": 4
                },
                {
                  "kind": "radio",
                  "label": "Base Ladders",
                  "setting": "cartoon_ring_mode",
                  "value": 0
                },
                {
                  "kind": "separator"
                },
                {
                  "kind": "radio",
                  "label": "Bases and Sugars",
                  "setting": "cartoon_ring_finder",
                  "value": 1
                },
                {
                  "kind": "radio",
                  "label": "Bases Only",
                  "setting": "cartoon_ring_finder",
                  "value": 2
                },
                {
                  "kind": "radio",
                  "label": "Non-protein Rings",
                  "setting": "cartoon_ring_finder",
                  "value": 3
                },
                {
                  "kind": "radio",
                  "label": "All Rings",
                  "setting": "cartoon_ring_finder",
                  "value": 4
                },
                {
                  "kind": "separator"
                },
                {
                  "kind": "radio",
                  "label": "Transparent Rings",
                  "setting": "cartoon_ring_transparency",
                  "value": 0.5
                },
                {
                  "kind": "radio",
                  "label": "Default",
                  "setting": "cartoon_ring_transparency",
                  "value": -1
                }
              ]
            },
            {
              "kind": "check",
              "label": "Side Chain Helper",
              "setting": "cartoon_side_chain_helper",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Round Helices",
              "setting": "cartoon_round_helices",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Fancy Helices",
              "setting": "cartoon_fancy_helices",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Cylindrical Helices",
              "setting": "cartoon_cylindrical_helices",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Flat Sheets",
              "setting": "cartoon_flat_sheets",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Fancy Sheets",
              "setting": "cartoon_fancy_sheets",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Smooth Loops",
              "setting": "cartoon_smooth_loops",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Discrete Colors",
              "setting": "cartoon_discrete_colors",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Highlight Color",
              "setting": "cartoon_highlight_color",
              "trueValue": 104,
              "falseValue": -1
            },
            {
              "kind": "submenu",
              "label": "Sampling",
              "items": [
                {
                  "kind": "radio",
                  "label": "Atom count dependent",
                  "setting": "cartoon_sampling",
                  "value": -1
                },
                {
                  "kind": "radio",
                  "label": "2",
                  "setting": "cartoon_sampling",
                  "value": 2
                },
                {
                  "kind": "radio",
                  "label": "7",
                  "setting": "cartoon_sampling",
                  "value": 7
                },
                {
                  "kind": "radio",
                  "label": "14",
                  "setting": "cartoon_sampling",
                  "value": 14
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Gap Cutoff",
              "items": [
                {
                  "kind": "radio",
                  "label": "0",
                  "setting": "cartoon_gap_cutoff",
                  "value": 0
                },
                {
                  "kind": "radio",
                  "label": "5",
                  "setting": "cartoon_gap_cutoff",
                  "value": 5
                },
                {
                  "kind": "radio",
                  "label": "10",
                  "setting": "cartoon_gap_cutoff",
                  "value": 10
                },
                {
                  "kind": "radio",
                  "label": "20",
                  "setting": "cartoon_gap_cutoff",
                  "value": 20
                }
              ]
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Ribbon",
          "items": [
            {
              "kind": "check",
              "label": "Side Chain Helper",
              "setting": "ribbon_side_chain_helper",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Trace Atoms",
              "setting": "ribbon_trace_atoms",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "As Lines",
              "setting": "ribbon_as_cylinders",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "As Cylinders",
              "setting": "ribbon_as_cylinders",
              "value": 1
            },
            {
              "kind": "submenu",
              "label": "Cylinder Radius",
              "items": [
                {
                  "kind": "radio",
                  "label": "Match Line Width",
                  "setting": "ribbon_radius",
                  "value": 0.0
                },
                {
                  "kind": "radio",
                  "label": "0.2 Angstrom",
                  "setting": "ribbon_radius",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "0.5 Angstrom",
                  "setting": "ribbon_radius",
                  "value": 0.5
                },
                {
                  "kind": "radio",
                  "label": "1.0 Angstrom",
                  "setting": "ribbon_radius",
                  "value": 1.0
                }
              ]
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Surface",
          "items": [
            {
              "kind": "submenu",
              "label": "Color",
              "items": [
                {
                  "kind": "radio",
                  "label": "White",
                  "setting": "surface_color",
                  "value": 0
                },
                {
                  "kind": "radio",
                  "label": "Light Gray",
                  "setting": "surface_color",
                  "value": 4236
                },
                {
                  "kind": "radio",
                  "label": "Gray",
                  "setting": "surface_color",
                  "value": 25
                },
                {
                  "kind": "radio",
                  "label": "Default (Atomic)",
                  "setting": "surface_color",
                  "value": -1
                }
              ]
            },
            {
              "kind": "radio",
              "label": "Dot",
              "setting": "surface_type",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Wireframe",
              "setting": "surface_type",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "Solid",
              "setting": "surface_type",
              "value": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "Cavities and Pockets Only",
              "setting": "surface_cavity_mode",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Cavities and Pockets (Culled)",
              "setting": "surface_cavity_mode",
              "value": 2
            },
            {
              "kind": "submenu",
              "label": "Cavity Detection Radius",
              "items": [
                {
                  "kind": "radio",
                  "label": "7 Angstrom",
                  "setting": "surface_cavity_radius",
                  "value": 7
                },
                {
                  "kind": "radio",
                  "label": "3 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -3
                },
                {
                  "kind": "radio",
                  "label": "4 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -4
                },
                {
                  "kind": "radio",
                  "label": "5 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -5
                },
                {
                  "kind": "radio",
                  "label": "6 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -6
                },
                {
                  "kind": "radio",
                  "label": "8 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -8
                },
                {
                  "kind": "radio",
                  "label": "10 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -10
                },
                {
                  "kind": "radio",
                  "label": "20 Solvent Radii",
                  "setting": "surface_cavity_radius",
                  "value": -20
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Cavity Detection Cutoff",
              "items": [
                {
                  "kind": "radio",
                  "label": "1 Solvent Radii",
                  "setting": "surface_cavity_cutoff",
                  "value": -1
                },
                {
                  "kind": "radio",
                  "label": "2 Solvent Radii",
                  "setting": "surface_cavity_cutoff",
                  "value": -2
                },
                {
                  "kind": "radio",
                  "label": "3 Solvent Radii",
                  "setting": "surface_cavity_cutoff",
                  "value": -3
                },
                {
                  "kind": "radio",
                  "label": "4 Solvent Radii",
                  "setting": "surface_cavity_cutoff",
                  "value": -4
                },
                {
                  "kind": "radio",
                  "label": "5 Solvent Radii",
                  "setting": "surface_cavity_cutoff",
                  "value": -5
                }
              ]
            },
            {
              "kind": "radio",
              "label": "Exterior (Normal)",
              "setting": "surface_cavity_mode",
              "value": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Solvent Accessible",
              "setting": "surface_solvent",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Smooth Edges",
              "setting": "surface_smooth_edges",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Edge Proximity",
              "setting": "surface_proximity",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "radio",
              "label": "Ignore None",
              "setting": "surface_mode",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Ignore HETATMs",
              "setting": "surface_mode",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "Ignore Hydrogens",
              "setting": "surface_mode",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "Ignore Unsurfaced",
              "setting": "surface_mode",
              "value": 3
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Volume",
          "items": [
            {
              "kind": "check",
              "label": "Pre-integrated Rendering",
              "setting": "volume_mode",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "submenu",
              "label": "Number of Layers",
              "items": [
                {
                  "kind": "radio",
                  "label": "100",
                  "setting": "volume_layers",
                  "value": 100.0
                },
                {
                  "kind": "radio",
                  "label": "256",
                  "setting": "volume_layers",
                  "value": 256.0
                },
                {
                  "kind": "radio",
                  "label": "500",
                  "setting": "volume_layers",
                  "value": 500.0
                },
                {
                  "kind": "radio",
                  "label": "1000",
                  "setting": "volume_layers",
                  "value": 1000.0
                }
              ]
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Transparency",
          "items": [
            {
              "kind": "submenu",
              "label": "Surface",
              "items": [
                {
                  "kind": "radio",
                  "label": "Off",
                  "setting": "transparency",
                  "value": 0.0
                },
                {
                  "kind": "radio",
                  "label": "20%",
                  "setting": "transparency",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "40%",
                  "setting": "transparency",
                  "value": 0.4
                },
                {
                  "kind": "radio",
                  "label": "50%",
                  "setting": "transparency",
                  "value": 0.5
                },
                {
                  "kind": "radio",
                  "label": "60%",
                  "setting": "transparency",
                  "value": 0.6
                },
                {
                  "kind": "radio",
                  "label": "80%",
                  "setting": "transparency",
                  "value": 0.8
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Sphere",
              "items": [
                {
                  "kind": "radio",
                  "label": "Off",
                  "setting": "sphere_transparency",
                  "value": 0.0
                },
                {
                  "kind": "radio",
                  "label": "20%",
                  "setting": "sphere_transparency",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "40%",
                  "setting": "sphere_transparency",
                  "value": 0.4
                },
                {
                  "kind": "radio",
                  "label": "50%",
                  "setting": "sphere_transparency",
                  "value": 0.5
                },
                {
                  "kind": "radio",
                  "label": "60%",
                  "setting": "sphere_transparency",
                  "value": 0.6
                },
                {
                  "kind": "radio",
                  "label": "80%",
                  "setting": "sphere_transparency",
                  "value": 0.8
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Cartoon",
              "items": [
                {
                  "kind": "radio",
                  "label": "Off",
                  "setting": "cartoon_transparency",
                  "value": 0.0
                },
                {
                  "kind": "radio",
                  "label": "20%",
                  "setting": "cartoon_transparency",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "40%",
                  "setting": "cartoon_transparency",
                  "value": 0.4
                },
                {
                  "kind": "radio",
                  "label": "50%",
                  "setting": "cartoon_transparency",
                  "value": 0.5
                },
                {
                  "kind": "radio",
                  "label": "60%",
                  "setting": "cartoon_transparency",
                  "value": 0.6
                },
                {
                  "kind": "radio",
                  "label": "80%",
                  "setting": "cartoon_transparency",
                  "value": 0.8
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Stick",
              "items": [
                {
                  "kind": "radio",
                  "label": "Off",
                  "setting": "stick_transparency",
                  "value": 0.0
                },
                {
                  "kind": "radio",
                  "label": "20%",
                  "setting": "stick_transparency",
                  "value": 0.2
                },
                {
                  "kind": "radio",
                  "label": "40%",
                  "setting": "stick_transparency",
                  "value": 0.4
                },
                {
                  "kind": "radio",
                  "label": "50%",
                  "setting": "stick_transparency",
                  "value": 0.5
                },
                {
                  "kind": "radio",
                  "label": "60%",
                  "setting": "stick_transparency",
                  "value": 0.6
                },
                {
                  "kind": "radio",
                  "label": "80%",
                  "setting": "stick_transparency",
                  "value": 0.8
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "Uni-Layer",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.set",
                    "args": [
                      "transparency_mode",
                      2
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "backface_cull",
                      1
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "two_sided_lighting",
                      0
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Multi-Layer",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.set",
                    "args": [
                      "transparency_mode",
                      1
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "backface_cull",
                      0
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "two_sided_lighting",
                      1
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Multi-Layer (Real-time OIT)",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.set",
                    "args": [
                      "transparency_mode",
                      3
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "backface_cull",
                      0
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "two_sided_lighting",
                      -1
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Fast and Ugly",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.set",
                    "args": [
                      "transparency_mode",
                      0
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "backface_cull",
                      1
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  },
                  {
                    "fn": "cmd.set",
                    "args": [
                      "two_sided_lighting",
                      0
                    ],
                    "kwargs": {
                      "quiet": 0
                    }
                  }
                ]
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Angle-dependent",
              "setting": "ray_transparency_oblique",
              "trueValue": 1,
              "falseValue": 0
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Rendering",
          "items": [
            {
              "kind": "check",
              "label": "OpenGL 2.0 Shaders",
              "setting": "use_shaders",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Antialias (Ray Tracing)",
              "setting": "antialias",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "submenu",
              "label": "Antialias (Real Time)",
              "items": [
                {
                  "kind": "radio",
                  "label": "off",
                  "setting": "antialias_shader",
                  "value": 0
                },
                {
                  "kind": "radio",
                  "label": "FXAA",
                  "setting": "antialias_shader",
                  "value": 1
                },
                {
                  "kind": "radio",
                  "label": "SMAA",
                  "setting": "antialias_shader",
                  "value": 2
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "Modernize",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.util.modernize_rendering",
                    "args": [
                      1
                    ],
                    "kwargs": {},
                    "selfArg": true
                  }
                ]
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "submenu",
              "label": "Shadows",
              "items": [
                {
                  "kind": "command",
                  "label": "None",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "none"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Light",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "light"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Medium",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "medium"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Heavy",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "heavy"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Black",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "black"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "separator"
                },
                {
                  "kind": "command",
                  "label": "Matte",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "matte"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Soft",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "soft"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Occlusion",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "occlusion"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                },
                {
                  "kind": "command",
                  "label": "Occlusion2",
                  "action": {
                    "type": "call",
                    "calls": [
                      {
                        "fn": "cmd.util.ray_shadows",
                        "args": [
                          "occlusion2"
                        ],
                        "kwargs": {}
                      }
                    ]
                  }
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Texture",
              "items": [
                {
                  "kind": "radio",
                  "label": "None",
                  "setting": "ray_texture",
                  "value": 0
                },
                {
                  "kind": "radio",
                  "label": "Matte 1",
                  "setting": "ray_texture",
                  "value": 1
                },
                {
                  "kind": "radio",
                  "label": "Matte 2",
                  "setting": "ray_texture",
                  "value": 4
                },
                {
                  "kind": "radio",
                  "label": "Swirl 1",
                  "setting": "ray_texture",
                  "value": 2
                },
                {
                  "kind": "radio",
                  "label": "Swirl 2",
                  "setting": "ray_texture",
                  "value": 3
                },
                {
                  "kind": "radio",
                  "label": "Fiber",
                  "setting": "ray_texture",
                  "value": 5
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Interior Texture",
              "items": [
                {
                  "kind": "radio",
                  "label": "None",
                  "setting": "ray_interior_texture",
                  "value": 0
                },
                {
                  "kind": "radio",
                  "label": "Matte 1",
                  "setting": "ray_interior_texture",
                  "value": 1
                },
                {
                  "kind": "radio",
                  "label": "Matte 2",
                  "setting": "ray_interior_texture",
                  "value": 4
                },
                {
                  "kind": "radio",
                  "label": "Swirl 1",
                  "setting": "ray_interior_texture",
                  "value": 2
                },
                {
                  "kind": "radio",
                  "label": "Swirl 2",
                  "setting": "ray_interior_texture",
                  "value": 3
                },
                {
                  "kind": "radio",
                  "label": "Fiber",
                  "setting": "ray_interior_texture",
                  "value": 5
                }
              ]
            },
            {
              "kind": "submenu",
              "label": "Memory",
              "items": [
                {
                  "kind": "radio",
                  "label": "Use Less (slower)",
                  "setting": "hash_max",
                  "value": 70
                },
                {
                  "kind": "radio",
                  "label": "Use Standard Amount",
                  "setting": "hash_max",
                  "value": 100
                },
                {
                  "kind": "radio",
                  "label": "Use More (faster)",
                  "setting": "hash_max",
                  "value": 170
                },
                {
                  "kind": "radio",
                  "label": "Use Even More",
                  "setting": "hash_max",
                  "value": 230
                },
                {
                  "kind": "radio",
                  "label": "Use Most",
                  "setting": "hash_max",
                  "value": 300
                }
              ]
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Cull Backfaces",
              "setting": "backface_cull",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Opaque Interiors",
              "setting": "ray_interior_color",
              "trueValue": 74,
              "falseValue": -1
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "PDB File Loading",
          "items": [
            {
              "kind": "check",
              "label": "Ignore PDB Segment Identifier",
              "setting": "ignore_pdb_segi",
              "trueValue": 1,
              "falseValue": 0
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "mmCIF File Loading",
          "items": [
            {
              "kind": "check",
              "label": "Use \"auth\" Identifiers",
              "setting": "cif_use_auth",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Load Assembly (Biological Unit)",
              "setting": "assembly",
              "trueValue": "1",
              "falseValue": ""
            },
            {
              "kind": "check",
              "label": "Bonding by \"Chemical Component Dictionary\"",
              "setting": "connect_mode",
              "trueValue": 4,
              "falseValue": 0
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Map File Loading",
          "items": [
            {
              "kind": "check",
              "label": "Normalize CCP4 Maps",
              "setting": "normalize_ccp4_maps",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Normalize O Maps",
              "setting": "normalize_o_maps",
              "trueValue": 1,
              "falseValue": 0
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Auto-Show ...",
          "items": [
            {
              "kind": "check",
              "label": "Cartoon/Sticks/Spheres by Classification",
              "setting": "auto_show_classified",
              "trueValue": -1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Auto-Show Lines",
              "setting": "auto_show_lines",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Auto-Show Spheres",
              "setting": "auto_show_spheres",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Auto-Show Nonbonded",
              "setting": "auto_show_nonbonded",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "separator"
            },
            {
              "kind": "check",
              "label": "Auto-Show New Selections",
              "setting": "auto_show_selections",
              "trueValue": 1,
              "falseValue": 0
            },
            {
              "kind": "check",
              "label": "Auto-Hide Selections",
              "setting": "auto_hide_selections",
              "trueValue": 1,
              "falseValue": 0
            }
          ]
        },
        {
          "kind": "check",
          "label": "Auto-Zoom New Objects",
          "setting": "auto_zoom",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Auto-Remove Hydrogens",
          "setting": "auto_remove_hydrogens",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Show Text (Esc)",
          "setting": "text",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Overlay Text",
          "setting": "overlay",
          "trueValue": 1,
          "falseValue": 0
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Scene",
      "items": [
        {
          "kind": "command",
          "label": "Scenes...",
          "action": {
            "type": "hook",
            "hook": "scene_panel_menu_dialog"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Next [PgDn]",
          "accel": "PgDn",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.scene",
                "args": [
                  "",
                  "next"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "Previous [PgUp]",
          "accel": "PgUp",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.scene",
                "args": [
                  "",
                  "previous"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Append",
          "action": {
            "type": "do",
            "command": "scene new, store"
          }
        },
        {
          "kind": "submenu",
          "label": "Append...",
          "items": [
            {
              "kind": "command",
              "label": "Camera",
              "action": {
                "type": "do",
                "command": "scene new, store, color=0, rep=0"
              }
            },
            {
              "kind": "command",
              "label": "Color",
              "action": {
                "type": "do",
                "command": "scene new, store, view=0, rep=0"
              }
            },
            {
              "kind": "command",
              "label": "Reps",
              "action": {
                "type": "do",
                "command": "scene new, store, view=0, color=0"
              }
            },
            {
              "kind": "command",
              "label": "Reps + Color",
              "action": {
                "type": "do",
                "command": "scene new, store, view=0"
              }
            }
          ]
        },
        {
          "kind": "command",
          "label": "Insert Before",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.scene",
                "args": [
                  "",
                  "insert_before"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "Insert After",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.scene",
                "args": [
                  "",
                  "insert_after"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "Update",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.scene",
                "args": [
                  "auto",
                  "update"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Delete",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.scene",
                "args": [
                  "auto",
                  "clear"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Recall",
          "items": [
            {
              "kind": "command",
              "label": "F1",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F1",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F2",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F2",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F3",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F3",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F4",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F4",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F5",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F5",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F6",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F6",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F7",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F7",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F8",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F8",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F9",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F9",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F10",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F10",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F11",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F11",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F12",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F12",
                      "recall"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Store",
          "items": [
            {
              "kind": "command",
              "label": "F1",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F1",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F2",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F2",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F3",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F3",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F4",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F4",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F5",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F5",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F6",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F6",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F7",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F7",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F8",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F8",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F9",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F9",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F10",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F10",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F11",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F11",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F12",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F12",
                      "store"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "submenu",
          "label": "Clear",
          "items": [
            {
              "kind": "command",
              "label": "F1",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F1",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F2",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F2",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F3",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F3",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F4",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F4",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F5",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F5",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F6",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F6",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F7",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F7",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F8",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F8",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F9",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F9",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F10",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F10",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F11",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F11",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "F12",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.scene",
                    "args": [
                      "F12",
                      "clear"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Buttons",
          "setting": "scene_buttons",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "submenu",
          "label": "Cache",
          "items": [
            {
              "kind": "command",
              "label": "Enable",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.cache",
                    "args": [
                      "enable"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Optimize",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.cache",
                    "args": [
                      "optimize"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Read Only",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.cache",
                    "args": [
                      "read_only"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Disable",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.cache",
                    "args": [
                      "disable"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Mouse",
      "items": [
        {
          "kind": "submenu",
          "label": "Selection Mode",
          "items": [
            {
              "kind": "radio",
              "label": "Atoms",
              "setting": "mouse_selection_mode",
              "value": 0
            },
            {
              "kind": "radio",
              "label": "Residues",
              "setting": "mouse_selection_mode",
              "value": 1
            },
            {
              "kind": "radio",
              "label": "Chains",
              "setting": "mouse_selection_mode",
              "value": 2
            },
            {
              "kind": "radio",
              "label": "Segments",
              "setting": "mouse_selection_mode",
              "value": 3
            },
            {
              "kind": "radio",
              "label": "Objects",
              "setting": "mouse_selection_mode",
              "value": 4
            },
            {
              "kind": "radio",
              "label": "Molecules",
              "setting": "mouse_selection_mode",
              "value": 5
            },
            {
              "kind": "radio",
              "label": "C-alphas",
              "setting": "mouse_selection_mode",
              "value": 6
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "3 Button Motions",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.config_mouse",
                "args": [
                  "three_button_motions"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "3 Button Editing",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.config_mouse",
                "args": [
                  "three_button_editing"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "3 Button Viewing",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.mouse",
                "args": [
                  "three_button_viewing"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "3 Button Lights",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.mouse",
                "args": [
                  "three_button_lights"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "3 Button All Modes",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.config_mouse",
                "args": [
                  "three_button_all_modes"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "2 Button Editing",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.config_mouse",
                "args": [
                  "two_button_editing"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "2 Button Viewing",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.config_mouse",
                "args": [
                  "two_button"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "1 Button Viewing Mode",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.mouse",
                "args": [
                  "one_button_viewing"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "command",
          "label": "Emulate Maestro",
          "action": {
            "type": "call",
            "calls": [
              {
                "fn": "cmd.mouse",
                "args": [
                  "three_button_maestro"
                ],
                "kwargs": {}
              }
            ]
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "check",
          "label": "Virtual Trackball",
          "setting": "virtual_trackball",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Show Mouse Grid",
          "setting": "mouse_grid",
          "trueValue": 1,
          "falseValue": 0
        },
        {
          "kind": "check",
          "label": "Roving Origin",
          "setting": "roving_origin",
          "trueValue": 1,
          "falseValue": 0
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Wizard",
      "items": [
        {
          "kind": "command",
          "label": "Appearance",
          "action": {
            "type": "do",
            "command": "wizard appearance"
          }
        },
        {
          "kind": "command",
          "label": "Measurement",
          "action": {
            "type": "do",
            "command": "wizard measurement"
          }
        },
        {
          "kind": "submenu",
          "label": "Mutagenesis",
          "items": [
            {
              "kind": "command",
              "label": "Protein",
              "action": {
                "type": "do",
                "command": "wizard mutagenesis"
              }
            },
            {
              "kind": "command",
              "label": "Nucleic Acids",
              "action": {
                "type": "do",
                "command": "wizard nucmutagenesis"
              }
            }
          ]
        },
        {
          "kind": "command",
          "label": "Pair Fitting",
          "action": {
            "type": "do",
            "command": "wizard pair_fit"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Density",
          "action": {
            "type": "do",
            "command": "wizard density"
          }
        },
        {
          "kind": "command",
          "label": "Filter",
          "action": {
            "type": "do",
            "command": "wizard filter"
          }
        },
        {
          "kind": "command",
          "label": "Sculpting",
          "action": {
            "type": "do",
            "command": "wizard sculpting"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "Label",
          "action": {
            "type": "do",
            "command": "wizard label"
          }
        },
        {
          "kind": "command",
          "label": "Charge",
          "action": {
            "type": "do",
            "command": "wizard charge"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Demo",
          "items": [
            {
              "kind": "command",
              "label": "Representations",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "reps"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Cartoon Ribbons",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "cartoon"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Roving Detail",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "roving"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Roving Density",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "roving_density"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Transparency",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "trans"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Ray Tracing",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "ray"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Sculpting",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "sculpt"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Scripted Animation",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "anime"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Electrostatics",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "elec"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Compiled Graphics Objects",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "cgo"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "command",
              "label": "Molscript/Raster3D Input",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.wizard",
                    "args": [
                      "demo",
                      "raster3d"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            },
            {
              "kind": "separator"
            },
            {
              "kind": "command",
              "label": "End Demonstration",
              "action": {
                "type": "call",
                "calls": [
                  {
                    "fn": "cmd.replace_wizard",
                    "args": [
                      "demo",
                      "finish"
                    ],
                    "kwargs": {}
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "kind": "submenu",
      "label": "Plugin",
      "items": []
    },
    {
      "kind": "submenu",
      "label": "Help",
      "items": [
        {
          "kind": "command",
          "label": "PyMOL Home Page",
          "action": {
            "type": "url",
            "url": "http://www.pymol.org"
          }
        },
        {
          "kind": "command",
          "label": "PyMOL Product Page",
          "action": {
            "type": "url",
            "url": "https://www.schrodinger.com/platform/products/pymol/"
          }
        },
        {
          "kind": "command",
          "label": "PyMOL Community Wiki",
          "action": {
            "type": "url",
            "url": "http://www.pymolwiki.org"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "PyMOL Command Reference",
          "action": {
            "type": "url",
            "url": "http://pymol.org/pymol-command-ref.html"
          }
        },
        {
          "kind": "command",
          "label": "PyMOL 3 Documentation",
          "action": {
            "type": "url",
            "url": "https://learn.schrodinger.com/public/pymol/current/Content/pymol/pymol_home.htm"
          }
        },
        {
          "kind": "command",
          "label": "Legacy Online Documentation",
          "action": {
            "type": "url",
            "url": "http://pymol.org/d/"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "submenu",
          "label": "Topics",
          "items": [
            {
              "kind": "command",
              "label": "Selection Algebra",
              "action": {
                "type": "url",
                "url": "https://pymolwiki.org/index.php/Selection_Algebra"
              }
            },
            {
              "kind": "command",
              "label": "Settings",
              "action": {
                "type": "url",
                "url": "https://pymolwiki.org/index.php/Settings"
              }
            },
            {
              "kind": "command",
              "label": "Timeline Python API",
              "action": {
                "type": "url",
                "url": "https://pymolwiki.org/index.php/Timeline_Python_API"
              }
            }
          ]
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "PyMOL Mailing List",
          "action": {
            "type": "url",
            "url": "https://lists.sourceforge.net/lists/listinfo/pymol-users"
          }
        },
        {
          "kind": "separator"
        },
        {
          "kind": "command",
          "label": "About PyMOL",
          "action": {
            "type": "hook",
            "hook": "show_about"
          }
        },
        {
          "kind": "command",
          "label": "Sponsorship Information",
          "action": {
            "type": "url",
            "url": "http://pymol.org/funding.html"
          }
        },
        {
          "kind": "command",
          "label": "How to Cite PyMOL",
          "action": {
            "type": "url",
            "url": "http://pymol.org/citing"
          }
        }
      ]
    }
  ],
  "settings": [
    "secondary_structure",
    "auto_sculpt",
    "sculpting",
    "sculpting_cycles",
    "sculpt_field_mask",
    "movie_fps",
    "show_frame_rate",
    "movie_auto_interpolate",
    "movie_panel",
    "movie_loop",
    "draw_frames",
    "ray_trace_frames",
    "cache_frames",
    "static_singletons",
    "all_states",
    "seq_view",
    "seq_view_format",
    "seq_view_label_mode",
    "seq_view_gap_mode",
    "internal_gui",
    "internal_prompt",
    "internal_feedback",
    "overlay",
    "stereo",
    "opaque_background",
    "show_alpha_checker",
    "bg_rgb",
    "grid_mode",
    "orthoscopic",
    "valence",
    "line_smooth",
    "depth_cue",
    "two_sided_lighting",
    "specular",
    "animation",
    "roving_detail",
    "label_size",
    "label_font_id",
    "label_color",
    "label_connector",
    "label_bg_color",
    "stick_ball",
    "stick_ball_ratio",
    "valence_zero_mode",
    "valence_zero_scale",
    "stick_radius",
    "stick_h_scale",
    "line_width",
    "line_as_cylinders",
    "cartoon_ring_mode",
    "cartoon_ring_finder",
    "cartoon_ring_transparency",
    "cartoon_side_chain_helper",
    "cartoon_round_helices",
    "cartoon_fancy_helices",
    "cartoon_cylindrical_helices",
    "cartoon_flat_sheets",
    "cartoon_fancy_sheets",
    "cartoon_smooth_loops",
    "cartoon_discrete_colors",
    "cartoon_highlight_color",
    "cartoon_sampling",
    "cartoon_gap_cutoff",
    "ribbon_side_chain_helper",
    "ribbon_trace_atoms",
    "ribbon_as_cylinders",
    "ribbon_radius",
    "surface_color",
    "surface_type",
    "surface_cavity_mode",
    "surface_cavity_radius",
    "surface_cavity_cutoff",
    "surface_solvent",
    "surface_smooth_edges",
    "surface_proximity",
    "surface_mode",
    "volume_mode",
    "volume_layers",
    "transparency",
    "sphere_transparency",
    "cartoon_transparency",
    "stick_transparency",
    "ray_transparency_oblique",
    "use_shaders",
    "antialias",
    "antialias_shader",
    "ray_texture",
    "ray_interior_texture",
    "hash_max",
    "backface_cull",
    "ray_interior_color",
    "ignore_pdb_segi",
    "cif_use_auth",
    "assembly",
    "connect_mode",
    "normalize_ccp4_maps",
    "normalize_o_maps",
    "auto_show_classified",
    "auto_show_lines",
    "auto_show_spheres",
    "auto_show_nonbonded",
    "auto_show_selections",
    "auto_hide_selections",
    "auto_zoom",
    "auto_remove_hydrogens",
    "text",
    "scene_buttons",
    "mouse_selection_mode",
    "virtual_trackball",
    "mouse_grid",
    "roving_origin"
  ]
} as MenusPayload;

export default MENU_DATA;
