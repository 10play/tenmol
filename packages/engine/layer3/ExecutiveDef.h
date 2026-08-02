#pragma once

#include <unordered_map>

#include "Ortho.h"
#include "ScrollBar.h"

class SpecRec;
class CGO;
struct CTracker;
struct OVLexicon;

struct ExecutiveObjectOffset{
  ObjectMolecule *obj;
  int atm;
};



struct PanelRec {
  SpecRec *spec;
  unsigned nest_level;
  bool is_group = false;
  bool is_open = false;

  PanelRec(SpecRec* spec_, unsigned nest_level_)
      : spec(spec_)
      , nest_level(nest_level_)
  {
  }
};

struct ListMember{
  int list_id;
  int next;
};

enum class ExecutiveDragMode {
  Off,
  Visibility,
  Reorder,
  VisibilityWithCamera
};

enum class ExecutiveToggleMode {
  DeferVisibility,
  ImmediateVisibility,
  HoverActivate,
  CenterActivateDeactivatePrevious,
  ZoomActivateDeactivatePrevious,
  ZoomExclusiveActivate
};

struct CExecutive : public Block {
  SpecRec *Spec {};
  CTracker *Tracker {};
  int Width {}, Height {}, HowFarDown { 0 };
  int ScrollBarActive { 0 };
  int NSkip { 0 };
  ScrollBar m_ScrollBar;
  pymol::CObject *LastEdited { nullptr };
  ExecutiveDragMode DragMode = ExecutiveDragMode::Off;
  ExecutiveToggleMode ToggleMode = ExecutiveToggleMode::DeferVisibility;
  int Pressed { -1 }, Over { -1 }, LastOver {}, OldVisibility {}, PressedWhat {}, OverWhat {};
  SpecRec *LastChanged { nullptr }, *LastZoomed { nullptr }, *RecoverPressed { nullptr };
  int ReorderFlag { false };
  OrthoLineType ReorderLog {};
#ifndef GLUT_FULL_SCREEN
  // freeglut has glutLeaveFullScreen, no need to remember window dimensions
  int oldPX {}, oldPY {}, oldWidth {}, oldHeight {};
#endif
  int all_names_list_id {}, all_obj_list_id {}, all_sel_list_id {};
  OVLexicon *Lex {};
  std::unordered_map<ov_word, int> Key;
  bool ValidGroups { false };
  bool ValidSceneMembers { false };
  int ValidGridSlots {};

  std::vector<PanelRec> Panel{};

  /* tenmol web client -- BEGIN (impl plan 03 s4 Task 6: change counters)
   *
   * Monotonic "something changed" counters.  They are *hints*, not content
   * hashes: the web accessor (layer4/CmdWebGeometry.cpp) uses them purely to
   * decide whether it is worth re-deriving the exact per-(object,rep,state)
   * versions it hands to the browser.  A poll that sees all four unchanged can
   * return its cached answer without touching a single Rep.
   *
   * m_web_panel_version  object list / order / group structure changed
   * m_web_enable_version an object was enabled or disabled
   * m_web_name_version   an object was renamed
   * m_web_rep_version    a representation was invalidated (show/hide/colour/
   *                      setting side effect/coordinate edit)
   */
  unsigned m_web_panel_version{0};
  unsigned m_web_enable_version{0};
  unsigned m_web_name_version{0};
  unsigned m_web_rep_version{0};
  /* tenmol web client -- END */

#ifdef _WEBGL
#endif
  int CaptureFlag {};
  int LastMotionCount {};
  CGO *selIndicatorsCGO { nullptr };
  int selectorTexturePosX { 0 }, selectorTexturePosY { 0 }, selectorTextureAllocatedSize { 0 }, selectorTextureSize { 0 };
  short selectorIsRound { 0 };

  // AtomInfoType::unique_id -> (object, atom-index)
  std::vector<ExecutiveObjectOffset> m_eoo {}; // vector of (object, atom-index)
  std::unordered_map<ov_word, std::size_t> m_id2eoo {}; // unique_id -> m_eoo-index
  std::unordered_map<const pymol::CObject*, std::unordered_set<const pymol::CObject*>> m_objDeps;

  CExecutive(PyMOLGlobals * G) : Block(G), m_ScrollBar(G, false) {};

  int release(int button, int x, int y, int mod) override;
  int click(int button, int x, int y, int mod) override;
  int drag(int x, int y, int mod) override;
  void draw(CGO* orthoCGO) override;
  void reshape(int width, int height) override;
};
