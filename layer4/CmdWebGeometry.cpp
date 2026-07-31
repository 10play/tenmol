/*
 * tenmol web client - C++ geometry accessor  (implementation plan 03 s4, tasks 1+2)
 *
 * Exposes PyMOL's *own* per-representation geometry to Python as binary buffers,
 * keyed per (object, rep, state), carrying atom indices, so that a browser client
 * can draw the exact same primitives PyMOL would draw ("Mode G").
 *
 * Design rules this file obeys (see docs/webclient/spikes/06-geometry-accessor.md):
 *
 *  1. NEVER read back a VBO.  Once a CGO has been optimised for the GPU the CPU
 *     copy is deliberately dropped (layer1/CGO.h:183-186).  We therefore only ever
 *     read the *primitive* CGO that each Rep keeps around for the ray tracer:
 *         RepCylBond::primitiveCGO, RepSphere::primitiveCGO, RepWireBond::primitiveCGO,
 *         RepRibbon::primitiveCGO, RepNonbonded::primitiveCGO,
 *         RepNonbondedSphere::primitiveCGO, RepCartoon::(ray ? ray : preshader),
 *         RepEllipsoid::(ray ? ray : std)
 *     If only a VBO-backed CGO exists we say so ("vbo-only"), we never emit empty
 *     buffers silently.
 *
 *  2. Spheres and cylinders are emitted as INSTANCE BUFFERS (centre/radius,
 *     origin/axis/radius/caps), never tessellated.  Tessellating is what makes the
 *     text exporters explode (a 660-atom `mesh` becomes 31,710 cylinders + 63,420
 *     spheres, a 31.9 MB .wrl - spike 03 s4).
 *
 *  3. Surfaces come straight out of RepSurface's CPU arrays as an INDEXED triangle
 *     mesh with a per-vertex atom index (RepSurface::AT), which no exporter provides.
 *
 *  4. Reps whose CPU-side geometry lives in a struct that upstream declares inside
 *     its .cpp (RepSurface, RepCartoon, RepCylBond, ...) are reached through a
 *     *layout mirror* declared below.  Every mirror is validated at run time before
 *     any pointer in it is dereferenced (see checkRep* / cgoLooksSane).  If a future
 *     upstream change moves a field, the validator fails and the call returns
 *     status "layout-mismatch" instead of reading garbage.
 *
 * Method-table registration lives in layer4/Cmd.cpp inside a sentinel-marked block.
 *
 * ---------------------------------------------------------------------------
 * Wave 2 additions (see docs/webclient/spikes/08-native-changes.md)
 *
 *  A. web_get_versions()  - plan s4 Task 6.  Exact per-(object, rep, state)
 *     change detection so the bridge stops hashing content at 4 Hz.  Backed by
 *     four monotonic counters on struct CExecutive (layer3/ExecutiveDef.h),
 *     bumped from sentinel-marked sites in layer3/Executive.cpp.  When all four
 *     are unchanged the call short-circuits and touches no Rep at all, so an
 *     idle poll can never produce a false positive.
 *
 *  B. web_resolve_pick() - plan s4 Task 3.  The CGO_PICK_COLOR (index, bond)
 *     pairs already emitted next to every vertex/instance are *stable atom and
 *     bond indices*, not pick colours (pick colours are a per-frame draw-order
 *     counter, PickColorManager::colorNext, and are unshippable).  This entry
 *     point turns (object, index, bond) back into a PyMOL selection, an atom
 *     description and a transformed coordinate, with no GL context.
 *
 *  C. More reps: cell + extent (line boxes), dashes/angles/dihedrals (ObjectDist
 *     raw float vertex arrays) and standalone CGO objects.
 * ---------------------------------------------------------------------------
 */

#include "os_python.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "PyMOLGlobals.h"
#include "PyMOL.h"
#include "PyMOLEnums.h"
#include "P.h"
#include "PConv.h"
#include "Err.h"
#include "Executive.h"
#include "ObjectMolecule.h"
#include "ObjectDist.h"
#include "ObjectCGO.h"
#include "DistSet.h"
#include "CoordSet.h"
#include "Rep.h"
#include "CGO.h"
#include "Color.h"
#include "Scene.h"
#include "Setting.h"
#include "RepSphere.h"
#include "RepDot.h"
#include "MemoryDebug.h"

/* Declared here (rather than in a header we do not own) so that layer4/Cmd.cpp
 * needs only a one-line forward declaration next to its method table. */
PyObject* CmdWebGetRepGeometry(PyObject* self, PyObject* args);
PyObject* CmdWebGetVersions(PyObject* self, PyObject* args);
PyObject* CmdWebResolvePick(PyObject* self, PyObject* args);

/* Defined in layer3/Executive.cpp inside a sentinel-marked block; reads the four
 * change counters declared on struct CExecutive (layer3/ExecutiveDef.h). */
void ExecutiveWebGetChangeCounters(PyMOLGlobals* G, unsigned* out);

namespace
{

/* ------------------------------------------------------------------------- *
 * Constants duplicated from layer1/CGO.cpp:55-68 and layer0/ShaderMgr.h:430
 * (both are private to those translation units).  These describe the memory
 * layout of a CGO_DRAW_ARRAYS block and are asserted against `narrays` below.
 * ------------------------------------------------------------------------- */
constexpr int kPosSize = 3;
constexpr int kNormalSize = 3;
constexpr int kColorSize = 4;
constexpr int kPickRGBASize = 1;  // 4 unsigned bytes packed in one float slot
constexpr int kPickIndexSize = 2; // (index, bond) as two int32 in float slots
constexpr int kAccessibilitySize = 1;

/* ------------------------------------------------------------------------- *
 * Layout mirrors of upstream file-local Rep structs.
 *
 * Each mirror repeats, in order and with identical types, the data members that
 * the upstream derived class declares.  The `Rep` base sub-object comes from the
 * real layer1/Rep.h, so only the derived part can ever drift.
 * ------------------------------------------------------------------------- */
namespace mirror
{

/// mirror of layer2/RepSurface.cpp:59-100
struct RepSurface : ::Rep {
  int N;
  int NT;
  bool proximity;
  std::vector<float> V;
  std::vector<float> VN;
  std::vector<float> VC;
  std::vector<float> VA;
  std::vector<float> VAO;
  std::vector<int> RC;
  std::vector<int> Vis;
  std::vector<int> T;
  std::vector<int> S;
  std::vector<int> AT;
  bool oneColorFlag;
  int oneColor;
  bool allVisibleFlag;
  char* LastVisib;
  int* LastColor;
  bool ColorInvalidated;
  int Type; // enum class SurfaceType : int
  float max_vdw;
  CGO* shaderCGO;
  CGO* pickingCGO;
  bool dot_as_spheres;
  int surface_mode;
};

/// mirror of layer2/RepCartoon.cpp:65-91
struct RepCartoon : ::Rep {
  CGO* ray;
  CGO* std;
  CGO* preshader;
  char* LastVisib;
};

/// mirror of layer2/RepCylBond.cpp:39-49
struct RepCylBond : ::Rep {
  CGO* primitiveCGO;
  CGO* renderCGO;
};

/// mirror of layer2/RepWireBond.cpp:34-45
struct RepWireBond : ::Rep {
  CGO* shaderCGO;
  CGO* primitiveCGO;
  bool shaderCGO_has_cylinders;
};

/// mirror of layer2/RepRibbon.cpp:37-50
struct RepRibbon : ::Rep {
  float ribbon_width;
  float radius;
  CGO* shaderCGO;
  CGO* primitiveCGO;
  bool shaderCGO_has_cylinders;
};

/// mirror of layer2/RepNonbonded.cpp:33-44
struct RepNonbonded : ::Rep {
  CGO* primitiveCGO;
  CGO* shaderCGO;
  bool shaderCGO_has_cylinders;
};

/// mirror of layer2/RepNonbondedSphere.cpp:35-44
struct RepNonbondedSphere : ::Rep {
  CGO* shaderCGO;
  CGO* primitiveCGO;
};

/// mirror of layer2/RepEllipsoid.cpp:33-44
struct RepEllipsoid : ::Rep {
  CGO* ray;
  CGO* std;
  CGO* shaderCGO;
};

/// mirror of layer2/RepMesh.cpp:39-63.  `pymol::vla<T>` holds exactly one `T*`
/// (layer0/vla.h:42) so a raw pointer is layout-compatible.
struct RepMesh : ::Rep {
  int* N;
  int NTot;
  float* V;
  float* VC;
  int NDot;
  float* Dot;
  float Radius, Width;
  int oneColorFlag;
  int oneColor;
  int* LastVisib;
  int* LastColor;
  float max_vdw;
  cIsomeshMode mesh_type;
  CGO* shaderCGO;
};

/// mirror of layer2/RepDistDash.cpp:40-55, layer2/RepAngle.cpp:36-51 and
/// layer2/RepDihedral.cpp:35-48.  All three share the same prefix; RepAngle
/// declares `pymol::vla<float> V`, which holds exactly one `float*`
/// (layer0/vla.h:42), so one mirror covers all three.  `ds` is the strongest
/// validator we have: it must equal the DistSet we reached the rep through.
struct RepDistLines : ::Rep {
  float* V;
  int N;
  DistSet* ds;
  float linewidth, radius;
  CGO* shaderCGO;
};

} // namespace mirror

/* ------------------------------------------------------------------------- *
 * Small helpers
 * ------------------------------------------------------------------------- */

/// `bytes` object holding float32 data, or None for an empty buffer.
PyObject* f32Bytes(const float* p, size_t n)
{
  if (!p || n == 0) {
    Py_RETURN_NONE;
  }
  return PConvFloatArrayToPyList(p, static_cast<int>(n), /*dump_binary*/ true);
}

PyObject* f32Bytes(const std::vector<float>& v)
{
  return f32Bytes(v.data(), v.size());
}

/// `bytes` object holding int32 data, or None for an empty buffer.
PyObject* i32Bytes(const int* p, size_t n)
{
  if (!p || n == 0) {
    Py_RETURN_NONE;
  }
  return PConvIntArrayToPyList(p, static_cast<int>(n), /*dump_binary*/ true);
}

PyObject* i32Bytes(const std::vector<int>& v)
{
  return i32Bytes(v.data(), v.size());
}

/// Reinterpret a run of CGO float slots that actually hold int32 (pick colours).
PyObject* i32BytesFromFloatSlots(const float* p, size_t n)
{
  if (!p || n == 0) {
    Py_RETURN_NONE;
  }
  return PyBytes_FromStringAndSize(
      reinterpret_cast<const char*>(p), n * sizeof(float));
}

void dictSet(PyObject* d, const char* key, PyObject* value)
{
  if (!value) {
    PyErr_Clear();
    Py_INCREF(Py_None);
    value = Py_None;
  }
  PyDict_SetItemString(d, key, value);
  Py_DECREF(value);
}

void dictSetInt(PyObject* d, const char* key, long v)
{
  dictSet(d, key, PyLong_FromLong(v));
}

void dictSetFloat(PyObject* d, const char* key, double v)
{
  dictSet(d, key, PyFloat_FromDouble(v));
}

void dictSetStr(PyObject* d, const char* key, const char* v)
{
  dictSet(d, key, PyUnicode_FromString(v));
}

PyObject* rgbList(const float* c)
{
  PyObject* l = PyList_New(3);
  for (int i = 0; i < 3; ++i) {
    PyList_SetItem(l, i, PyFloat_FromDouble(c[i]));
  }
  return l;
}

/* ------------------------------------------------------------------------- *
 * rep name <-> index
 * ------------------------------------------------------------------------- */
struct RepNameEntry {
  const char* name;
  cRep_t rep;
};

const RepNameEntry kRepNames[] = {
    {"sticks", cRepCyl},                     //
    {"stick", cRepCyl},                      //
    {"spheres", cRepSphere},                 //
    {"sphere", cRepSphere},                  //
    {"surface", cRepSurface},                //
    {"labels", cRepLabel},                   //
    {"label", cRepLabel},                    //
    {"nb_spheres", cRepNonbondedSphere},     //
    {"cartoon", cRepCartoon},                //
    {"ribbon", cRepRibbon},                  //
    {"lines", cRepLine},                     //
    {"line", cRepLine},                      //
    {"mesh", cRepMesh},                      //
    {"dots", cRepDot},                       //
    {"dot", cRepDot},                        //
    {"dashes", cRepDash},                    //
    {"nonbonded", cRepNonbonded},            //
    {"cell", cRepCell},                      //
    {"cgo", cRepCGO},                        //
    {"callback", cRepCallback},              //
    {"extent", cRepExtent},                  //
    {"slice", cRepSlice},                    //
    {"angles", cRepAngle},                   //
    {"dihedrals", cRepDihedral},             //
    {"ellipsoids", cRepEllipsoid},           //
    {"ellipsoid", cRepEllipsoid},            //
    {"volume", cRepVolume},                  //
};

const char* repIndexToName(int rep)
{
  for (const auto& e : kRepNames) {
    if (e.rep == rep) {
      return e.name;
    }
  }
  return "?";
}

/// @return rep index, or -1 if not recognised
int repNameToIndex(const char* name)
{
  for (const auto& e : kRepNames) {
    if (std::strcmp(e.name, name) == 0) {
      return e.rep;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------------- *
 * Mirror validation
 * ------------------------------------------------------------------------- */

/// Cheap structural check that `cgo` really is a CGO reached through a mirror.
/// CGO::G is the first data member (layer1/CGO.h:772) and every CGO belongs to
/// the same PyMOLGlobals as the Rep that owns it.
bool cgoLooksSane(const CGO* cgo, PyMOLGlobals* G)
{
  if (!cgo) {
    return true; // absent, not corrupt
  }
  if (cgo->G != G) {
    return false;
  }
  if (cgo->c > 0 && !cgo->op) {
    return false;
  }
  // every op code must be a legal index into CGO_sz
  size_t nops = 0;
  for (auto it = cgo->begin(); !it.is_stop(); ++it) {
    if (it.op_code() >= CGO_sz_size()) {
      return false;
    }
    if (++nops > (cgo->c + 2)) { // walked further than the buffer can hold
      return false;
    }
  }
  return true;
}

bool checkSurfaceMirror(const mirror::RepSurface* I)
{
  const size_t N = static_cast<size_t>(I->N);
  const size_t NT = static_cast<size_t>(I->NT);
  if (I->N < 0 || I->NT < 0) {
    return false;
  }
  if (I->V.size() != 3 * N || I->VN.size() != 3 * N) {
    return false;
  }
  if (I->T.size() != 3 * NT) {
    return false;
  }
  if (!I->VC.empty() && I->VC.size() != 3 * N) {
    return false;
  }
  if (!I->VA.empty() && I->VA.size() != N) {
    return false;
  }
  if (!I->VAO.empty() && I->VAO.size() != N) {
    return false;
  }
  if (!I->Vis.empty() && I->Vis.size() != N) {
    return false;
  }
  if (!I->AT.empty() && I->AT.size() != N) {
    return false;
  }
  for (int t : I->T) {
    if (t < 0 || static_cast<size_t>(t) >= N) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------------- *
 * CGO walker -> typed instance buffers
 * ------------------------------------------------------------------------- */

struct DrawArraysBlock {
  int mode = 0;
  int arraybits = 0;
  int nverts = 0;
  const float* vertex = nullptr;
  const float* normal = nullptr;
  const float* color = nullptr;
  const float* pick = nullptr; // (index, bond) int32 pairs
  const float* accessibility = nullptr;
};

struct CgoHarvest {
  // spheres:  centre.xyz + radius
  std::vector<float> sphere_xyzr;
  std::vector<float> sphere_rgba;
  std::vector<int> sphere_pick;

  // shader cylinders: origin.xyz + axis.xyz + radius
  std::vector<float> cyl_origin_axis_r;
  std::vector<int> cyl_cap;
  std::vector<float> cyl_rgba1;
  std::vector<float> cyl_rgba2;
  std::vector<int> cyl_pick1;
  std::vector<int> cyl_pick2;

  // cones (also used for CGO_CYLINDER / SAUSAGE / CUSTOM_CYLINDER endpoints)
  std::vector<float> cone_v1v2_r1r2;
  std::vector<int> cone_cap;
  std::vector<float> cone_rgba1;
  std::vector<float> cone_rgba2;
  std::vector<int> cone_pick;

  // ellipsoids: centre.xyz + radius, then 3 axis vectors
  std::vector<float> ell_xyzr;
  std::vector<float> ell_axes;
  std::vector<float> ell_rgba;
  std::vector<int> ell_pick;

  // free triangles (CGO_TRIANGLE)
  std::vector<float> tri_vertex;
  std::vector<float> tri_normal;
  std::vector<float> tri_color;
  std::vector<int> tri_pick;

  // nonbonded crosses (CGO_VERTEX_CROSS): centre only; the client expands it to
  // three axis-aligned segments of +/- nonbonded_size (layer1/CGO.cpp:5879-5896)
  std::vector<float> cross_xyz;
  std::vector<float> cross_rgba;
  std::vector<int> cross_pick;

  // lines (CGO_LINE / CGO_SPLITLINE)
  std::vector<float> line_vertex;
  std::vector<float> line_rgba1;
  std::vector<float> line_rgba2;
  std::vector<int> line_pick1;
  std::vector<int> line_pick2;

  std::vector<DrawArraysBlock> draw_arrays;

  // immediate-mode CGO_BEGIN..CGO_END runs, densified into arrays
  struct BeginEndBlock {
    int mode = 0;
    int nverts = 0;
    std::vector<float> vertex;
    std::vector<float> normal;
    std::vector<float> color;
    std::vector<int> pick;
  };
  std::vector<BeginEndBlock> begin_end;

  int op_counts[256] = {0};
  int unhandled_counts[256] = {0};
  int vbo_ops = 0;
  bool ok = true;
};

struct CgoState {
  float color[3] = {1.f, 1.f, 1.f};
  float alpha = 1.f;
  float normal[3] = {0.f, 0.f, 1.f};
  int pick_index = 0;
  int pick_bond = cPickableNoPick;
};

void pushRGBA(std::vector<float>& v, const float* rgb, float a)
{
  v.push_back(rgb[0]);
  v.push_back(rgb[1]);
  v.push_back(rgb[2]);
  v.push_back(a);
}

void pushVec(std::vector<float>& v, const float* p, int n)
{
  for (int i = 0; i < n; ++i) {
    v.push_back(p[i]);
  }
}

void pushPick(std::vector<int>& v, int index, int bond)
{
  v.push_back(index);
  v.push_back(bond);
}

bool isVboOp(unsigned op)
{
  switch (op) {
  case CGO_DRAW_BUFFERS_INDEXED:
  case CGO_DRAW_BUFFERS_NOT_INDEXED:
  case CGO_DRAW_CYLINDER_BUFFERS:
  case CGO_DRAW_SPHERE_BUFFERS:
  case CGO_DRAW_TEXTURES:
  case CGO_DRAW_SCREEN_TEXTURES_AND_POLYGONS:
  case CGO_DRAW_LABELS:
  case CGO_DRAW_CONNECTORS:
  case CGO_DRAW_TRILINES:
  case CGO_DRAW_CUSTOM:
  case CGO_DRAW_BEZIER:
  case CGO_BIND_VBO_FOR_PICKING:
    return true;
  }
  return false;
}

/// Decode one CGO_DRAW_ARRAYS block.  Layout is documented at layer1/CGO.h:167
/// and implemented at layer1/CGO.cpp:1645-1672.
DrawArraysBlock decodeDrawArrays(const cgo::draw::arrays* sp)
{
  DrawArraysBlock b;
  b.mode = sp->mode;
  b.arraybits = sp->arraybits;
  b.nverts = sp->nverts;

  const float* p = sp->get_data();
  if (sp->arraybits & CGO_VERTEX_ARRAY) {
    b.vertex = p;
    p += kPosSize * sp->nverts;
  }
  if (sp->arraybits & CGO_NORMAL_ARRAY) {
    b.normal = p;
    p += kNormalSize * sp->nverts;
  }
  if (sp->arraybits & CGO_COLOR_ARRAY) {
    b.color = p;
    p += kColorSize * sp->nverts;
  }
  if (sp->arraybits & CGO_PICK_COLOR_ARRAY) {
    p += kPickRGBASize * sp->nverts; // packed rgba, regenerated at pick time
    b.pick = p;
    p += kPickIndexSize * sp->nverts;
  }
  if (sp->arraybits & CGO_ACCESSIBILITY_ARRAY) {
    b.accessibility = p;
    p += kAccessibilitySize * sp->nverts;
  }
  return b;
}

void harvestCGO(const CGO* cgo, CgoHarvest& out)
{
  CgoState st;
  st.alpha = cgo->alpha;

  bool in_begin = false;
  CgoHarvest::BeginEndBlock cur;

  for (auto it = cgo->begin(); !it.is_stop(); ++it) {
    const unsigned op = it.op_code();
    const float* pc = it.data();

    if (op < 256) {
      out.op_counts[op]++;
    }

    if (isVboOp(op)) {
      out.vbo_ops++;
      continue;
    }

    switch (op) {

    /* ---- state ---- */
    case CGO_COLOR:
      st.color[0] = pc[0];
      st.color[1] = pc[1];
      st.color[2] = pc[2];
      break;
    case CGO_ALPHA:
      st.alpha = pc[0];
      break;
    case CGO_NORMAL:
      st.normal[0] = pc[0];
      st.normal[1] = pc[1];
      st.normal[2] = pc[2];
      break;
    case CGO_RESET_NORMAL:
      st.normal[0] = 0.f;
      st.normal[1] = 0.f;
      st.normal[2] = 1.f;
      break;
    case CGO_PICK_COLOR:
      st.pick_index = static_cast<int>(CGO_get_uint(pc));
      st.pick_bond = CGO_get_int(pc + 1);
      break;

    /* ---- instanced primitives ---- */
    case CGO_SPHERE: {
      auto sp = reinterpret_cast<const cgo::draw::sphere*>(pc);
      pushVec(out.sphere_xyzr, sp->center, 3);
      out.sphere_xyzr.push_back(sp->diamter); // radius (name is an upstream typo)
      pushRGBA(out.sphere_rgba, st.color, st.alpha);
      pushPick(out.sphere_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_SHADER_CYLINDER: {
      auto sp = reinterpret_cast<const cgo::draw::shadercylinder*>(pc);
      pushVec(out.cyl_origin_axis_r, sp->origin, 3);
      pushVec(out.cyl_origin_axis_r, sp->axis, 3);
      out.cyl_origin_axis_r.push_back(sp->tube_size);
      out.cyl_cap.push_back(sp->cap);
      pushRGBA(out.cyl_rgba1, st.color, st.alpha);
      pushRGBA(out.cyl_rgba2, st.color, st.alpha);
      pushPick(out.cyl_pick1, st.pick_index, st.pick_bond);
      pushPick(out.cyl_pick2, st.pick_index, st.pick_bond);
    } break;

    case CGO_SHADER_CYLINDER_WITH_2ND_COLOR: {
      auto sp = reinterpret_cast<const cgo::draw::shadercylinder2ndcolor*>(pc);
      pushVec(out.cyl_origin_axis_r, sp->origin, 3);
      pushVec(out.cyl_origin_axis_r, sp->axis, 3);
      out.cyl_origin_axis_r.push_back(sp->tube_size);
      out.cyl_cap.push_back(sp->cap);
      const float a2 = (sp->alpha < 0.f) ? st.alpha : sp->alpha;
      pushRGBA(out.cyl_rgba1, st.color, st.alpha);
      pushRGBA(out.cyl_rgba2, sp->color2, a2);
      pushPick(out.cyl_pick1, st.pick_index, st.pick_bond);
      pushPick(out.cyl_pick2, static_cast<int>(sp->pick_color_index),
          sp->pick_color_bond);
    } break;

    case CGO_CYLINDER: {
      auto sp = reinterpret_cast<const cgo::draw::cylinder*>(pc);
      pushVec(out.cone_v1v2_r1r2, sp->vertex1, 3);
      pushVec(out.cone_v1v2_r1r2, sp->vertex2, 3);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_cap.push_back(static_cast<int>(cCylCap::Flat));
      out.cone_cap.push_back(static_cast<int>(cCylCap::Flat));
      pushRGBA(out.cone_rgba1, sp->color1, st.alpha);
      pushRGBA(out.cone_rgba2, sp->color2, st.alpha);
      pushPick(out.cone_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_SAUSAGE: {
      auto sp = reinterpret_cast<const cgo::draw::cylinder*>(pc);
      pushVec(out.cone_v1v2_r1r2, sp->vertex1, 3);
      pushVec(out.cone_v1v2_r1r2, sp->vertex2, 3);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_cap.push_back(static_cast<int>(cCylCap::Round));
      out.cone_cap.push_back(static_cast<int>(cCylCap::Round));
      pushRGBA(out.cone_rgba1, sp->color1, st.alpha);
      pushRGBA(out.cone_rgba2, sp->color2, st.alpha);
      pushPick(out.cone_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_CUSTOM_CYLINDER: {
      auto sp = reinterpret_cast<const cgo::draw::custom_cylinder*>(pc);
      pushVec(out.cone_v1v2_r1r2, sp->vertex1, 3);
      pushVec(out.cone_v1v2_r1r2, sp->vertex2, 3);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_cap.push_back(static_cast<int>(sp->get_cap1()));
      out.cone_cap.push_back(static_cast<int>(sp->get_cap2()));
      pushRGBA(out.cone_rgba1, sp->color1, st.alpha);
      pushRGBA(out.cone_rgba2, sp->color2, st.alpha);
      pushPick(out.cone_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_CUSTOM_CYLINDER_ALPHA: {
      auto sp = reinterpret_cast<const cgo::draw::custom_cylinder_alpha*>(pc);
      pushVec(out.cone_v1v2_r1r2, sp->vertex1, 3);
      pushVec(out.cone_v1v2_r1r2, sp->vertex2, 3);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_v1v2_r1r2.push_back(sp->radius);
      out.cone_cap.push_back(static_cast<int>(sp->get_cap1()));
      out.cone_cap.push_back(static_cast<int>(sp->get_cap2()));
      pushRGBA(out.cone_rgba1, sp->color1, sp->color1[3]);
      pushRGBA(out.cone_rgba2, sp->color2, sp->color2[3]);
      pushPick(out.cone_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_CONE: {
      auto sp = reinterpret_cast<const cgo::draw::cone*>(pc);
      pushVec(out.cone_v1v2_r1r2, sp->vertex1, 3);
      pushVec(out.cone_v1v2_r1r2, sp->vertex2, 3);
      out.cone_v1v2_r1r2.push_back(sp->radius1);
      out.cone_v1v2_r1r2.push_back(sp->radius2);
      out.cone_cap.push_back(static_cast<int>(sp->get_cap1()));
      out.cone_cap.push_back(static_cast<int>(sp->get_cap2()));
      pushRGBA(out.cone_rgba1, sp->color1, st.alpha);
      pushRGBA(out.cone_rgba2, sp->color2, st.alpha);
      pushPick(out.cone_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_ELLIPSOID: {
      // layer1/CGO.cpp:896-918 -> centre[3], r, n1[3], n2[3], n3[3]
      pushVec(out.ell_xyzr, pc, 4);
      pushVec(out.ell_axes, pc + 4, 9);
      pushRGBA(out.ell_rgba, st.color, st.alpha);
      pushPick(out.ell_pick, st.pick_index, st.pick_bond);
    } break;

    /* ---- explicit triangles ---- */
    case CGO_TRIANGLE: {
      // v1 v2 v3 n1 n2 n3 c1 c2 c3  (layer1/CGO.cpp:6067-6069)
      pushVec(out.tri_vertex, pc + 0, 9);
      pushVec(out.tri_normal, pc + 9, 9);
      for (int v = 0; v < 3; ++v) {
        pushRGBA(out.tri_color, pc + 18 + 3 * v, st.alpha);
      }
      pushPick(out.tri_pick, st.pick_index, st.pick_bond);
    } break;

    /* ---- lines ---- */
    case CGO_LINE: {
      auto sp = reinterpret_cast<const cgo::draw::line*>(pc);
      pushVec(out.line_vertex, sp->vertex1, 3);
      pushVec(out.line_vertex, sp->vertex2, 3);
      pushRGBA(out.line_rgba1, st.color, st.alpha);
      pushRGBA(out.line_rgba2, st.color, st.alpha);
      pushPick(out.line_pick1, st.pick_index, st.pick_bond);
      pushPick(out.line_pick2, st.pick_index, st.pick_bond);
    } break;

    case CGO_SPLITLINE: {
      auto sp = reinterpret_cast<const cgo::draw::splitline*>(pc);
      pushVec(out.line_vertex, sp->vertex1, 3);
      pushVec(out.line_vertex, sp->vertex2, 3);
      const float c2[3] = {sp->color2[0] / 255.f, sp->color2[1] / 255.f,
          sp->color2[2] / 255.f};
      pushRGBA(out.line_rgba1, st.color, st.alpha);
      pushRGBA(out.line_rgba2, c2, st.alpha);
      pushPick(out.line_pick1, st.pick_index, st.pick_bond);
      pushPick(out.line_pick2, static_cast<int>(sp->index), sp->bond);
    } break;

    /* ---- vertex arrays ---- */
    case CGO_DRAW_ARRAYS: {
      auto sp = reinterpret_cast<const cgo::draw::arrays*>(pc);
      if (!sp->get_data() || sp->nverts <= 0) {
        out.unhandled_counts[CGO_DRAW_ARRAYS]++;
        break;
      }
      out.draw_arrays.push_back(decodeDrawArrays(sp));
    } break;

    /* ---- immediate mode ---- */
    case CGO_BEGIN: {
      in_begin = true;
      cur = CgoHarvest::BeginEndBlock();
      cur.mode = CGO_get_int(pc);
    } break;

    case CGO_END: {
      if (in_begin && cur.nverts > 0) {
        out.begin_end.push_back(std::move(cur));
      }
      in_begin = false;
      cur = CgoHarvest::BeginEndBlock();
    } break;

    case CGO_VERTEX_CROSS: {
      pushVec(out.cross_xyz, pc, 3);
      pushRGBA(out.cross_rgba, st.color, st.alpha);
      pushPick(out.cross_pick, st.pick_index, st.pick_bond);
    } break;

    case CGO_VERTEX:
    case CGO_VERTEX_BEGIN_LINE_STRIP: {
      if (in_begin) {
        pushVec(cur.vertex, pc, 3);
        pushVec(cur.normal, st.normal, 3);
        pushRGBA(cur.color, st.color, st.alpha);
        pushPick(cur.pick, st.pick_index, st.pick_bond);
        cur.nverts++;
      } else {
        out.unhandled_counts[op & 0xff]++;
      }
    } break;

    /* ---- deliberately ignored render-state ops ---- */
    case CGO_NULL:
    case CGO_STOP:
    case CGO_ENABLE:
    case CGO_DISABLE:
    case CGO_SPECIAL:
    case CGO_SPECIAL_WITH_ARG:
    case CGO_LINEWIDTH:
    case CGO_WIDTHSCALE:
    case CGO_DOTWIDTH:
    case CGO_ACCESSIBILITY:
    case CGO_INTERPOLATED:
    case CGO_BOUNDING_BOX:
    case CGO_MASK_ATTRIBUTE_IF_PICKING:
    case CGO_VERTEX_ATTRIB_3F:
    case CGO_VERTEX_ATTRIB_4UB:
    case CGO_VERTEX_ATTRIB_1F:
    case CGO_VERTEX_ATTRIB_4UB_IF_PICKING:
    case CGO_UNIFORM3F:
      break;

    default:
      out.unhandled_counts[op & 0xff]++;
      break;
    }
  }

  if (in_begin && cur.nverts > 0) {
    out.begin_end.push_back(std::move(cur));
  }
}

PyObject* harvestToPyDict(const CgoHarvest& h)
{
  PyObject* d = PyDict_New();

  /* spheres */
  {
    PyObject* s = PyDict_New();
    dictSetInt(s, "n", h.sphere_xyzr.size() / 4);
    dictSet(s, "xyzr", f32Bytes(h.sphere_xyzr));
    dictSet(s, "rgba", f32Bytes(h.sphere_rgba));
    dictSet(s, "pick", i32Bytes(h.sphere_pick));
    dictSet(d, "spheres", s);
  }

  /* shader cylinders (origin + axis + radius, i.e. an instance buffer) */
  {
    PyObject* c = PyDict_New();
    dictSetInt(c, "n", h.cyl_origin_axis_r.size() / 7);
    dictSet(c, "origin_axis_radius", f32Bytes(h.cyl_origin_axis_r));
    dictSet(c, "cap", i32Bytes(h.cyl_cap));
    dictSet(c, "rgba1", f32Bytes(h.cyl_rgba1));
    dictSet(c, "rgba2", f32Bytes(h.cyl_rgba2));
    dictSet(c, "pick1", i32Bytes(h.cyl_pick1));
    dictSet(c, "pick2", i32Bytes(h.cyl_pick2));
    dictSet(d, "cylinders", c);
  }

  /* cones / classic cylinders */
  {
    PyObject* c = PyDict_New();
    dictSetInt(c, "n", h.cone_v1v2_r1r2.size() / 8);
    dictSet(c, "v1v2_r1r2", f32Bytes(h.cone_v1v2_r1r2));
    dictSet(c, "cap", i32Bytes(h.cone_cap));
    dictSet(c, "rgba1", f32Bytes(h.cone_rgba1));
    dictSet(c, "rgba2", f32Bytes(h.cone_rgba2));
    dictSet(c, "pick", i32Bytes(h.cone_pick));
    dictSet(d, "cones", c);
  }

  /* ellipsoids */
  {
    PyObject* e = PyDict_New();
    dictSetInt(e, "n", h.ell_xyzr.size() / 4);
    dictSet(e, "xyzr", f32Bytes(h.ell_xyzr));
    dictSet(e, "axes", f32Bytes(h.ell_axes));
    dictSet(e, "rgba", f32Bytes(h.ell_rgba));
    dictSet(e, "pick", i32Bytes(h.ell_pick));
    dictSet(d, "ellipsoids", e);
  }

  /* free triangles */
  {
    PyObject* t = PyDict_New();
    dictSetInt(t, "n", h.tri_vertex.size() / 9);
    dictSet(t, "vertex", f32Bytes(h.tri_vertex));
    dictSet(t, "normal", f32Bytes(h.tri_normal));
    dictSet(t, "rgba", f32Bytes(h.tri_color));
    dictSet(t, "pick", i32Bytes(h.tri_pick));
    dictSet(d, "triangles", t);
  }

  /* nonbonded crosses */
  {
    PyObject* c = PyDict_New();
    dictSetInt(c, "n", h.cross_xyz.size() / 3);
    dictSet(c, "xyz", f32Bytes(h.cross_xyz));
    dictSet(c, "rgba", f32Bytes(h.cross_rgba));
    dictSet(c, "pick", i32Bytes(h.cross_pick));
    dictSet(d, "crosses", c);
  }

  /* lines */
  {
    PyObject* l = PyDict_New();
    dictSetInt(l, "n", h.line_vertex.size() / 6);
    dictSet(l, "vertex", f32Bytes(h.line_vertex));
    dictSet(l, "rgba1", f32Bytes(h.line_rgba1));
    dictSet(l, "rgba2", f32Bytes(h.line_rgba2));
    dictSet(l, "pick1", i32Bytes(h.line_pick1));
    dictSet(l, "pick2", i32Bytes(h.line_pick2));
    dictSet(d, "lines", l);
  }

  /* CGO_DRAW_ARRAYS blocks, verbatim */
  {
    PyObject* list = PyList_New(0);
    for (const auto& b : h.draw_arrays) {
      PyObject* e = PyDict_New();
      dictSetInt(e, "mode", b.mode);
      dictSetInt(e, "arraybits", b.arraybits);
      dictSetInt(e, "nverts", b.nverts);
      dictSet(e, "vertex", f32Bytes(b.vertex, size_t(b.nverts) * kPosSize));
      dictSet(e, "normal", f32Bytes(b.normal, size_t(b.nverts) * kNormalSize));
      dictSet(e, "rgba", f32Bytes(b.color, size_t(b.nverts) * kColorSize));
      dictSet(e, "pick",
          i32BytesFromFloatSlots(b.pick, size_t(b.nverts) * kPickIndexSize));
      dictSet(e, "accessibility",
          f32Bytes(b.accessibility, size_t(b.nverts) * kAccessibilitySize));
      PyList_Append(list, e);
      Py_DECREF(e);
    }
    dictSet(d, "draw_arrays", list);
  }

  /* densified CGO_BEGIN..CGO_END runs */
  {
    PyObject* list = PyList_New(0);
    for (const auto& b : h.begin_end) {
      PyObject* e = PyDict_New();
      dictSetInt(e, "mode", b.mode);
      dictSetInt(e, "nverts", b.nverts);
      dictSet(e, "vertex", f32Bytes(b.vertex));
      dictSet(e, "normal", f32Bytes(b.normal));
      dictSet(e, "rgba", f32Bytes(b.color));
      dictSet(e, "pick", i32Bytes(b.pick));
      PyList_Append(list, e);
      Py_DECREF(e);
    }
    dictSet(d, "begin_end", list);
  }

  /* diagnostics: every op we saw, and every op we did not turn into geometry */
  {
    PyObject* ops = PyDict_New();
    PyObject* unh = PyDict_New();
    for (int i = 0; i < 256; ++i) {
      if (h.op_counts[i]) {
        PyObject* k = PyLong_FromLong(i);
        PyObject* v = PyLong_FromLong(h.op_counts[i]);
        PyDict_SetItem(ops, k, v);
        Py_DECREF(k);
        Py_DECREF(v);
      }
      if (h.unhandled_counts[i]) {
        PyObject* k = PyLong_FromLong(i);
        PyObject* v = PyLong_FromLong(h.unhandled_counts[i]);
        PyDict_SetItem(unh, k, v);
        Py_DECREF(k);
        Py_DECREF(v);
      }
    }
    dictSet(d, "ops", ops);
    dictSet(d, "unhandled_ops", unh);
    dictSetInt(d, "vbo_ops", h.vbo_ops);
  }

  return d;
}

/* ------------------------------------------------------------------------- *
 * Content signatures  (plan s4 Task 6)
 *
 * A signature is a 64-bit FNV-1a over the *meaningful* bytes of a rep's CPU
 * geometry.  It must be:
 *   - deterministic: identical geometry must produce an identical value, or an
 *     idle poll would report a phantom change (the whole point of Task 6);
 *   - pointer-free: `Rep*` is recycled by the allocator across a rebuild and a
 *     CGO's out-of-line `floatdata` blocks move, so neither may be hashed.
 * ------------------------------------------------------------------------- */

constexpr uint64_t kFnvOffset = 1469598103934665603ULL;
constexpr uint64_t kFnvPrime = 1099511628211ULL;

void hashBytes(uint64_t& h, const void* p, size_t n)
{
  auto b = static_cast<const unsigned char*>(p);
  for (size_t i = 0; i < n; ++i) {
    h = (h ^ b[i]) * kFnvPrime;
  }
}

void hashU64(uint64_t& h, uint64_t v)
{
  hashBytes(h, &v, sizeof(v));
}

void hashFloats(uint64_t& h, const float* p, size_t n)
{
  hashU64(h, n);
  if (p && n) {
    hashBytes(h, p, n * sizeof(float));
  }
}

void hashInts(uint64_t& h, const int* p, size_t n)
{
  hashU64(h, n);
  if (p && n) {
    hashBytes(h, p, n * sizeof(int));
  }
}

/// Signature of a CGO.  Mirrors CGOArrayAsPyList (layer1/CGO.cpp:241-287): the
/// op code plus exactly `CGO_sz[op]` payload floats, and for CGO_DRAW_ARRAYS the
/// out-of-line data block instead of the (unstable) pointer that holds it.
uint64_t cgoSignature(const CGO* cgo, uint64_t h = kFnvOffset)
{
  if (!cgo) {
    hashU64(h, 0xF01);
    return h;
  }
  hashBytes(h, &cgo->alpha, sizeof(cgo->alpha));
  for (auto it = cgo->begin(); !it.is_stop(); ++it) {
    const unsigned op = it.op_code();
    if (op >= CGO_sz_size()) { // corrupt; cgoLooksSane() will have caught it
      hashU64(h, 0xBAD);
      break;
    }
    const float* pc = it.data();
    size_t sz = CGO_sz[op];
    hashU64(h, op);

    if (op == CGO_DRAW_ARRAYS) {
      auto sp = reinterpret_cast<const cgo::draw::arrays*>(pc);
      hashU64(h, static_cast<uint64_t>(sp->mode));
      hashU64(h, static_cast<uint64_t>(sp->arraybits));
      hashU64(h, static_cast<uint64_t>(sp->nverts));
      pc = sp->get_data();
      sz = pc ? static_cast<size_t>(sp->get_data_length()) : 0;
    } else if (isVboOp(op)) {
      // Contains GPU handles and out-of-line pointers; nothing stable to hash.
      // The rep is reported "vbo-only" anyway, so an identity signature is fine.
      continue;
    }
    hashFloats(h, pc, sz);
  }
  return h;
}

/* ------------------------------------------------------------------------- *
 * Per-rep extraction
 * ------------------------------------------------------------------------- */

PyObject* makeResult(const char* status, const char* message)
{
  PyObject* d = PyDict_New();
  dictSetStr(d, "status", status);
  dictSetStr(d, "message", message ? message : "");
  dictSet(d, "ok", PyBool_FromLong(std::strcmp(status, "ok") == 0));
  return d;
}

/// Locate the primitive (non-VBO) CGO of `rep`, if this rep has one.
/// @param[out] have_mirror false if we do not know how to reach this rep at all
const CGO* primitiveCGOForRep(::Rep* rep, PyMOLGlobals* G, bool& have_mirror,
    bool& layout_ok, const char** which)
{
  have_mirror = true;
  layout_ok = true;
  *which = "";

  const CGO* cgo = nullptr;

  switch (rep->type()) {
  case cRepCyl: {
    auto I = reinterpret_cast<mirror::RepCylBond*>(rep);
    cgo = I->primitiveCGO;
    *which = "RepCylBond::primitiveCGO";
    layout_ok = cgoLooksSane(I->primitiveCGO, G) && cgoLooksSane(I->renderCGO, G);
  } break;
  case cRepSphere: {
    auto I = static_cast<RepSphere*>(rep); // struct is public (layer2/RepSphere.h)
    cgo = I->primitiveCGO;
    *which = "RepSphere::primitiveCGO";
    layout_ok = cgoLooksSane(I->primitiveCGO, G);
  } break;
  case cRepCartoon: {
    auto I = reinterpret_cast<mirror::RepCartoon*>(rep);
    layout_ok = cgoLooksSane(I->ray, G) && cgoLooksSane(I->preshader, G) &&
                cgoLooksSane(I->std, G);
    // After a GL render RepCartoonCGOGenerate calls disposePreshaderCGO(), which
    // *moves* preshader into `ray` (layer2/RepCartoon.cpp:80-89).  So the
    // primitive geometry is still reachable, just under a different name.
    cgo = I->ray ? I->ray : I->preshader;
    *which = I->ray ? "RepCartoon::ray" : "RepCartoon::preshader";
  } break;
  case cRepRibbon: {
    auto I = reinterpret_cast<mirror::RepRibbon*>(rep);
    layout_ok = cgoLooksSane(I->primitiveCGO, G) && cgoLooksSane(I->shaderCGO, G);
    cgo = I->primitiveCGO;
    *which = "RepRibbon::primitiveCGO";
  } break;
  case cRepLine: {
    auto I = reinterpret_cast<mirror::RepWireBond*>(rep);
    layout_ok = cgoLooksSane(I->primitiveCGO, G) && cgoLooksSane(I->shaderCGO, G);
    cgo = I->primitiveCGO;
    *which = "RepWireBond::primitiveCGO";
  } break;
  case cRepNonbonded: {
    auto I = reinterpret_cast<mirror::RepNonbonded*>(rep);
    layout_ok = cgoLooksSane(I->primitiveCGO, G) && cgoLooksSane(I->shaderCGO, G);
    cgo = I->primitiveCGO;
    *which = "RepNonbonded::primitiveCGO";
  } break;
  case cRepNonbondedSphere: {
    auto I = reinterpret_cast<mirror::RepNonbondedSphere*>(rep);
    layout_ok = cgoLooksSane(I->primitiveCGO, G) && cgoLooksSane(I->shaderCGO, G);
    cgo = I->primitiveCGO;
    *which = "RepNonbondedSphere::primitiveCGO";
  } break;
  case cRepEllipsoid: {
    auto I = reinterpret_cast<mirror::RepEllipsoid*>(rep);
    layout_ok = cgoLooksSane(I->ray, G) && cgoLooksSane(I->std, G);
    cgo = I->ray ? I->ray : I->std;
    *which = I->ray ? "RepEllipsoid::ray" : "RepEllipsoid::std";
  } break;
  default:
    have_mirror = false;
    break;
  }

  return cgo;
}

PyObject* extractSurface(::Rep* rep, PyMOLGlobals* G, ObjectMolecule* obj)
{
  auto I = reinterpret_cast<mirror::RepSurface*>(rep);

  if (!checkSurfaceMirror(I)) {
    return makeResult("layout-mismatch",
        "RepSurface layout mirror failed validation - layer2/RepSurface.cpp "
        "changed upstream; refusing to read");
  }

  if (I->N == 0 || I->NT == 0) {
    return makeResult("empty", "surface rep is built but has 0 vertices/triangles");
  }

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "surface");
  dictSetInt(d, "n_vert", I->N);
  dictSetInt(d, "n_tri", I->NT);
  dictSet(d, "vertex", f32Bytes(I->V));
  dictSet(d, "normal", f32Bytes(I->VN));
  dictSet(d, "index", i32Bytes(I->T));
  dictSet(d, "atom", i32Bytes(I->AT));
  dictSet(d, "visible", i32Bytes(I->Vis));
  dictSet(d, "alpha", f32Bytes(I->VA));
  dictSet(d, "ao", f32Bytes(I->VAO));
  dictSet(d, "one_color_flag", PyBool_FromLong(I->oneColorFlag));

  if (I->oneColorFlag) {
    dictSet(d, "rgb", rgbList(ColorGet(G, I->oneColor)));
    Py_INCREF(Py_None);
    dictSet(d, "color", Py_None);
  } else {
    dictSet(d, "color", f32Bytes(I->VC));
  }

  // Global fallback alpha, used when the per-vertex VA buffer is absent.
  float transp = SettingGet_f(G, rep->cs ? rep->cs->Setting.get() : nullptr,
      obj ? obj->Setting.get() : nullptr, cSetting_transparency);
  dictSetFloat(d, "default_alpha", 1.0 - transp);
  dictSetInt(d, "surface_mode", I->surface_mode);
  dictSetInt(d, "surface_type", I->Type);
  return d;
}

PyObject* extractDots(::Rep* rep, PyMOLGlobals* G)
{
  auto I = static_cast<RepDot*>(rep); // struct is public (layer2/RepDot.h)
  if (I->N <= 0 || !I->V) {
    return makeResult("empty", "dot rep is built but has 0 dots");
  }

  const size_t N = static_cast<size_t>(I->N);
  std::vector<float> vertex, normal, color;
  vertex.reserve(N * 3);
  normal.reserve(N * 3);
  color.reserve(N * 3);

  if (I->VN) {
    /* cRepDotAreaType (`cmd.get_area(load_b=1)` flavour): plain arrays plus a
     * real per-dot atom index (layer2/RepDot.cpp:434-443). */
    vertex.assign(I->V, I->V + N * 3);
    normal.assign(I->VN, I->VN + N * 3);
  } else {
    /* cRepDotNormal: `V` is a run-length encoded interleaved stream
     *   [ count, r, g, b, (nx ny nz  x y z) * count ] *
     * (layer2/RepDot.cpp:402-425).  Decode it into flat arrays. */
    const float* v = I->V;
    size_t emitted = 0;
    while (emitted < N) {
      const long run = static_cast<long>(*(v++));
      if (run <= 0 || emitted + static_cast<size_t>(run) > N) {
        return makeResult("layout-mismatch",
            "RepDot run-length stream inconsistent with RepDot::N");
      }
      const float rgb[3] = {v[0], v[1], v[2]};
      v += 3;
      for (long k = 0; k < run; ++k) {
        normal.insert(normal.end(), v, v + 3);
        v += 3;
        vertex.insert(vertex.end(), v, v + 3);
        v += 3;
        color.insert(color.end(), rgb, rgb + 3);
      }
      emitted += static_cast<size_t>(run);
    }
  }

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "dots");
  dictSetInt(d, "n_vert", I->N);
  dictSet(d, "vertex", f32Bytes(vertex));
  dictSet(d, "normal", f32Bytes(normal));
  dictSet(d, "color", f32Bytes(color));
  dictSet(d, "atom", i32Bytes(I->Atom, I->Atom ? N : 0));
  dictSetFloat(d, "dot_size", I->dotSize);
  dictSetFloat(d, "width", I->Width);
  return d;
}

PyObject* extractMesh(::Rep* rep, PyMOLGlobals* G)
{
  auto I = reinterpret_cast<mirror::RepMesh*>(rep);

  if (I->NTot < 0 || (I->NTot > 0 && (!I->V || !I->N))) {
    return makeResult("layout-mismatch",
        "RepMesh layout mirror failed validation - layer2/RepMesh.cpp changed "
        "upstream; refusing to read");
  }
  if (I->NTot == 0) {
    return makeResult("empty", "mesh rep is built but has 0 vertices");
  }

  // N is a zero-terminated list of line-strip lengths (layer2/RepMesh.cpp:422-431)
  std::vector<int> strips;
  long total = 0;
  for (const int* n = I->N; *n; ++n) {
    if (*n < 0 || total + *n > I->NTot) {
      return makeResult("layout-mismatch",
          "RepMesh strip lengths inconsistent with NTot");
    }
    strips.push_back(*n);
    total += *n;
    if (strips.size() > static_cast<size_t>(I->NTot) + 1) {
      return makeResult("layout-mismatch", "RepMesh strip list not terminated");
    }
  }

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "mesh");
  dictSetInt(d, "n_vert", total);
  dictSetInt(d, "n_strip", strips.size());
  dictSet(d, "strips", i32Bytes(strips));
  dictSet(d, "vertex", f32Bytes(I->V, size_t(total) * 3));
  dictSet(d, "one_color_flag", PyBool_FromLong(I->oneColorFlag));
  if (I->oneColorFlag) {
    dictSet(d, "rgb", rgbList(ColorGet(G, I->oneColor)));
    Py_INCREF(Py_None);
    dictSet(d, "color", Py_None);
  } else {
    dictSet(d, "color", f32Bytes(I->VC, size_t(total) * 3));
  }
  dictSetInt(d, "mesh_type", static_cast<int>(I->mesh_type));
  return d;
}

/* ------------------------------------------------------------------------- *
 * Measurement objects (ObjectDist): dashes / angles / dihedrals.
 *
 * RepDistDash / RepAngle / RepDihedral each keep a plain `float* V` of `N`
 * vertices that are consumed strictly in PAIRS as GL_LINES (see e.g.
 * layer2/RepDistDash.cpp:456-461 `CGOVertexv(v); CGOVertexv(v+3)`).  The dash
 * pattern is already baked into V by the rep builder, so the client draws the
 * segments verbatim - no dash_gap arithmetic client-side.
 * ------------------------------------------------------------------------- */
PyObject* extractDistLines(
    ::Rep* rep, PyMOLGlobals* G, DistSet* ds, const char* kind)
{
  auto I = reinterpret_cast<mirror::RepDistLines*>(rep);

  const bool layout_ok = I->ds == ds && I->N >= 0 && (I->N % 2) == 0 &&
                         (I->N == 0 || I->V != nullptr) &&
                         std::isfinite(I->radius) && std::isfinite(I->linewidth) &&
                         I->radius >= 0.f && I->linewidth >= 0.f &&
                         cgoLooksSane(I->shaderCGO, G);
  if (!layout_ok) {
    return makeResult("layout-mismatch",
        "Rep{DistDash,Angle,Dihedral} layout mirror failed validation - the "
        "upstream Rep struct changed; refusing to read");
  }
  if (I->N == 0) {
    return makeResult("empty", "measurement rep is built but has 0 vertices");
  }

  int color = SettingGet_color(
      G, nullptr, ds->Obj ? ds->Obj->Setting.get() : nullptr, cSetting_dash_color);
  if (color < 0 && rep->getObj()) {
    color = rep->getObj()->Color;
  }
  const float* rgb = ColorGet(G, color < 0 ? 0 : color);

  /* Reuse the `lines` bucket so the client needs one line primitive for the
   * lines / nonbonded / cell / extent / dash / angle / dihedral reps together. */
  CgoHarvest h;
  const size_t nseg = static_cast<size_t>(I->N) / 2;
  h.line_vertex.assign(I->V, I->V + size_t(I->N) * 3);
  for (size_t i = 0; i < nseg; ++i) {
    pushRGBA(h.line_rgba1, rgb, 1.f);
    pushRGBA(h.line_rgba2, rgb, 1.f);
    pushPick(h.line_pick1, 0, cPickableNoPick);
    pushPick(h.line_pick2, 0, cPickableNoPick);
  }

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "cgo");
  dictSetStr(d, "source", kind);
  dictSetFloat(d, "nonbonded_size", 0.0);
  /* RepDistDash/RepAngle/RepDihedral only assign their own `radius`/`linewidth`
   * members inside render() (e.g. layer2/RepDistDash.cpp:340), so on a
   * never-rendered rep - which is the GL-free case this accessor exists for -
   * they are still 0.  Read the two settings those lines read instead, and
   * report the raw members separately so a layout drift stays visible. */
  auto* oset = ds->Obj ? ds->Obj->Setting.get() : nullptr;
  dictSetFloat(d, "radius", SettingGet_f(G, nullptr, oset, cSetting_dash_radius));
  dictSetFloat(d, "linewidth", SettingGet_f(G, nullptr, oset, cSetting_dash_width));
  dictSetFloat(d, "rep_radius", I->radius);
  dictSetFloat(d, "rep_linewidth", I->linewidth);
  dictSet(d, "rgb", rgbList(rgb));
  PyObject* payload = harvestToPyDict(h);
  PyObject *k, *v;
  Py_ssize_t pos = 0;
  while (PyDict_Next(payload, &pos, &k, &v)) {
    PyDict_SetItem(d, k, v);
  }
  Py_DECREF(payload);
  return d;
}

/* ------------------------------------------------------------------------- *
 * Extent: the axis-aligned bounding box that `show extent` draws.  Twelve
 * segments built from CObject::ExtentMin/ExtentMax (layer1/PyMOLObject.h:81),
 * emitted through the same `lines` bucket as everything else.
 * ------------------------------------------------------------------------- */
PyObject* extractExtent(pymol::CObject* base, PyMOLGlobals* G)
{
  float mn[3], mx[3];
  const float* lo = base->ExtentMin;
  const float* hi = base->ExtentMax;

  if (!base->ExtentFlag) {
    /* ObjectMolecule never latches CObject::ExtentFlag (only map / mesh /
     * surface / CGO / callback objects do), so fall back to the same AABB
     * cmd.get_extent() reports. */
    if (!ExecutiveGetExtent(G, base->Name, mn, mx, /*transformed*/ true,
            /*state*/ -1, /*weighted*/ false)) {
      return makeResult("empty", "object has no computable extent");
    }
    lo = mn;
    hi = mx;
  }
  float corner[8][3];
  for (int i = 0; i < 8; ++i) {
    corner[i][0] = (i & 1) ? hi[0] : lo[0];
    corner[i][1] = (i & 2) ? hi[1] : lo[1];
    corner[i][2] = (i & 4) ? hi[2] : lo[2];
  }
  static const int kEdge[12][2] = {{0, 1}, {2, 3}, {4, 5}, {6, 7}, {0, 2}, {1, 3},
      {4, 6}, {5, 7}, {0, 4}, {1, 5}, {2, 6}, {3, 7}};

  const float* rgb = ColorGet(G, base->Color < 0 ? 0 : base->Color);

  CgoHarvest h;
  for (const auto& e : kEdge) {
    pushVec(h.line_vertex, corner[e[0]], 3);
    pushVec(h.line_vertex, corner[e[1]], 3);
    pushRGBA(h.line_rgba1, rgb, 1.f);
    pushRGBA(h.line_rgba2, rgb, 1.f);
    pushPick(h.line_pick1, 0, cPickableNoPick);
    pushPick(h.line_pick2, 0, cPickableNoPick);
  }

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "cgo");
  dictSetStr(d, "source", "CObject::ExtentMin/ExtentMax");
  dictSetFloat(d, "nonbonded_size", 0.0);
  dictSet(d, "rgb", rgbList(rgb));
  PyObject* payload = harvestToPyDict(h);
  PyObject *k, *v;
  Py_ssize_t pos = 0;
  while (PyDict_Next(payload, &pos, &k, &v)) {
    PyDict_SetItem(d, k, v);
  }
  Py_DECREF(payload);
  return d;
}

/// Harvest a bare CGO (unit cell, ObjectCGO state, ...) that is not owned by a Rep.
PyObject* extractBareCGO(const CGO* cgo, PyMOLGlobals* G, const char* which)
{
  if (!cgo) {
    return makeResult("not-built",
        "no CPU-side CGO for this rep/state (is it shown? try update=1)");
  }
  if (!cgoLooksSane(cgo, G)) {
    return makeResult("layout-mismatch", "CGO failed structural validation");
  }

  CgoHarvest h;
  harvestCGO(cgo, h);

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "cgo");
  dictSetStr(d, "source", which);
  dictSetFloat(d, "nonbonded_size", 0.0);
  PyObject* payload = harvestToPyDict(h);
  PyObject *k, *v;
  Py_ssize_t pos = 0;
  while (PyDict_Next(payload, &pos, &k, &v)) {
    PyDict_SetItem(d, k, v);
  }
  Py_DECREF(payload);

  const bool any = h.sphere_xyzr.size() || h.cyl_origin_axis_r.size() ||
                   h.cone_v1v2_r1r2.size() || h.ell_xyzr.size() ||
                   h.tri_vertex.size() || h.line_vertex.size() ||
                   h.cross_xyz.size() || h.draw_arrays.size() ||
                   h.begin_end.size();
  if (!any) {
    dictSetStr(d, "status", h.vbo_ops ? "vbo-only" : "empty");
    dictSetStr(d, "message",
        h.vbo_ops ? "CGO contains only VBO-backed draw ops; the CPU copy is gone"
                  : "CGO contains no geometry ops we can extract");
    dictSet(d, "ok", PyBool_FromLong(0));
  }
  return d;
}

PyObject* extractCGORep(::Rep* rep, PyMOLGlobals* G)
{
  bool have_mirror = false;
  bool layout_ok = false;
  const char* which = "";
  const CGO* cgo = primitiveCGOForRep(rep, G, have_mirror, layout_ok, &which);

  if (!have_mirror) {
    char buf[160];
    snprintf(buf, sizeof(buf),
        "rep '%s' has no CPU-side geometry accessor in CmdWebGeometry.cpp",
        repIndexToName(rep->type()));
    return makeResult("unsupported", buf);
  }
  if (!layout_ok) {
    char buf[200];
    snprintf(buf, sizeof(buf),
        "layout mirror for rep '%s' failed validation - the upstream Rep struct "
        "changed; refusing to read",
        repIndexToName(rep->type()));
    return makeResult("layout-mismatch", buf);
  }
  if (!cgo) {
    return makeResult("vbo-only",
        "no primitive CGO on this rep; only GPU buffers exist and the CPU copy "
        "was dropped on upload (layer1/CGO.h:183-186)");
  }

  CgoHarvest h;
  harvestCGO(cgo, h);

  PyObject* d = makeResult("ok", "");
  dictSetStr(d, "kind", "cgo");
  dictSetStr(d, "source", which);
  // needed to expand CGO_VERTEX_CROSS centres into three segments client-side
  dictSetFloat(d, "nonbonded_size",
      SettingGet_f(G, rep->cs ? rep->cs->Setting.get() : nullptr,
          rep->obj ? rep->obj->Setting.get() : nullptr, cSetting_nonbonded_size));
  PyObject* payload = harvestToPyDict(h);
  // merge payload into d
  PyObject *k, *v;
  Py_ssize_t pos = 0;
  while (PyDict_Next(payload, &pos, &k, &v)) {
    PyDict_SetItem(d, k, v);
  }
  Py_DECREF(payload);

  const bool any = h.sphere_xyzr.size() || h.cyl_origin_axis_r.size() ||
                   h.cone_v1v2_r1r2.size() || h.ell_xyzr.size() ||
                   h.tri_vertex.size() || h.line_vertex.size() ||
                   h.cross_xyz.size() || h.draw_arrays.size() ||
                   h.begin_end.size();
  if (!any) {
    dictSetStr(d, "status", h.vbo_ops ? "vbo-only" : "empty");
    dictSetStr(d, "message",
        h.vbo_ops ? "CGO contains only VBO-backed draw ops; the CPU copy is gone"
                  : "CGO contains no geometry ops we can extract");
    dictSet(d, "ok", PyBool_FromLong(0));
  }
  return d;
}

/* ------------------------------------------------------------------------- *
 * API entry / exit (local copies of the static helpers in layer4/Cmd.cpp:215,
 * :250 - we keep the GIL because we build large PyObjects).
 * ------------------------------------------------------------------------- */

PyMOLGlobals* globalsFromSelf(PyObject* self)
{
  if (self && PyCapsule_CheckExact(self)) {
    auto handle =
        reinterpret_cast<PyMOLGlobals**>(PyCapsule_GetPointer(self, nullptr));
    if (handle) {
      return *handle;
    }
  }
  return nullptr;
}

void webAPIEnterBlocked(PyMOLGlobals* G)
{
  if (!PIsGlutThread()) {
    G->P_inst->glut_thread_keep_out++;
  }
}

void webAPIExitBlocked(PyMOLGlobals* G)
{
  if (!PIsGlutThread()) {
    G->P_inst->glut_thread_keep_out--;
  }
}

/* ------------------------------------------------------------------------- *
 * Per-rep signature dispatch  (plan s4 Task 6)
 * ------------------------------------------------------------------------- */

uint64_t repSignature(::Rep* rep, PyMOLGlobals* G)
{
  uint64_t h = kFnvOffset;
  hashU64(h, static_cast<unsigned>(rep->type()));

  switch (rep->type()) {

  case cRepSurface: {
    auto I = reinterpret_cast<mirror::RepSurface*>(rep);
    if (!checkSurfaceMirror(I)) {
      hashU64(h, 0xBAD5u);
      break;
    }
    hashU64(h, static_cast<unsigned>(I->N));
    hashU64(h, static_cast<unsigned>(I->NT));
    hashFloats(h, I->V.data(), I->V.size());
    hashFloats(h, I->VN.data(), I->VN.size());
    hashFloats(h, I->VC.data(), I->VC.size());
    hashFloats(h, I->VA.data(), I->VA.size());
    hashFloats(h, I->VAO.data(), I->VAO.size());
    hashInts(h, I->T.data(), I->T.size());
    hashInts(h, I->AT.data(), I->AT.size());
    hashInts(h, I->Vis.data(), I->Vis.size());
    hashU64(h, I->oneColorFlag ? 1u : 0u);
    // RepSurface::recolor() mutates in place and returns `this`, so the colour
    // has to be in the signature or a recolour would be invisible to the poll.
    hashFloats(h, ColorGet(G, I->oneColor), 3);
  } break;

  case cRepMesh: {
    auto I = reinterpret_cast<mirror::RepMesh*>(rep);
    if (I->NTot < 0 || (I->NTot > 0 && (!I->V || !I->N))) {
      hashU64(h, 0xBADEu);
      break;
    }
    long total = 0;
    long nstrip = 0;
    for (const int* n = I->N; *n; ++n) {
      if (*n < 0 || total + *n > I->NTot || ++nstrip > I->NTot + 1) {
        total = -1;
        break;
      }
      total += *n;
    }
    if (total < 0) {
      hashU64(h, 0xBADFu);
      break;
    }
    hashU64(h, static_cast<uint64_t>(total));
    hashFloats(h, I->V, size_t(total) * 3);
    hashU64(h, I->oneColorFlag ? 1u : 0u);
    // RepMesh::recolor() also mutates in place (layer2/RepMesh.cpp:571).
    hashFloats(h, ColorGet(G, I->oneColor), 3);
    if (!I->oneColorFlag) {
      hashFloats(h, I->VC, size_t(total) * 3);
    }
  } break;

  case cRepDot: {
    auto I = static_cast<RepDot*>(rep);
    hashU64(h, static_cast<unsigned>(I->N));
    hashBytes(h, &I->dotSize, sizeof(I->dotSize));
    hashBytes(h, &I->Width, sizeof(I->Width));
    if (I->N > 0 && I->V) {
      if (I->VN) {
        hashFloats(h, I->V, size_t(I->N) * 3);
        hashFloats(h, I->VN, size_t(I->N) * 3);
      } else {
        /* run-length stream; walk it exactly as extractDots() does so we never
         * read past RepDot::N */
        const float* v = I->V;
        long emitted = 0;
        while (emitted < I->N) {
          const long run = static_cast<long>(*(v++));
          if (run <= 0 || emitted + run > I->N) {
            hashU64(h, 0xBADDu);
            break;
          }
          hashFloats(h, v, 3);      // colour of this run
          v += 3;
          hashFloats(h, v, size_t(run) * 6); // (normal, vertex) pairs
          v += run * 6;
          emitted += run;
        }
      }
    }
    hashInts(h, I->Atom, I->Atom ? size_t(I->N) : 0);
  } break;

  case cRepDash:
  case cRepAngle:
  case cRepDihedral: {
    auto I = reinterpret_cast<mirror::RepDistLines*>(rep);
    if (I->N < 0 || (I->N > 0 && !I->V)) {
      hashU64(h, 0xBAD1u);
      break;
    }
    hashFloats(h, I->V, size_t(I->N) * 3);
    /* I->radius / I->linewidth are only written by render(); hash the settings
     * they are written FROM so `set dash_radius` is visible to the poll. */
    auto* oset = rep->getObj() ? rep->getObj()->Setting.get() : nullptr;
    const float dr = SettingGet_f(G, nullptr, oset, cSetting_dash_radius);
    const float dw = SettingGet_f(G, nullptr, oset, cSetting_dash_width);
    hashBytes(h, &dr, sizeof(dr));
    hashBytes(h, &dw, sizeof(dw));
    int dc = SettingGet_color(G, nullptr, oset, cSetting_dash_color);
    if (dc < 0 && rep->getObj()) {
      dc = rep->getObj()->Color;
    }
    hashFloats(h, ColorGet(G, dc < 0 ? 0 : dc), 3);
  } break;

  default: {
    bool have_mirror = false;
    bool layout_ok = false;
    const char* which = "";
    const CGO* cgo = primitiveCGOForRep(rep, G, have_mirror, layout_ok, &which);
    if (!have_mirror) {
      /* No CPU accessor (labels, slice, volume, callback).  The signature can
       * only track "is it there at all"; the poll still sees show/hide. */
      hashU64(h, 0xAC0Eu);
      break;
    }
    if (!layout_ok) {
      hashU64(h, 0xBAD0u);
      break;
    }
    h = cgoSignature(cgo, h);
  } break;
  }

  return h;
}

/* ------------------------------------------------------------------------- *
 * Version cache  (plan s4 Task 6)
 *
 * The invariant the bridge relies on:
 *   - if nothing changed, every version is byte-identical to the previous call
 *     AND no Rep is touched at all (the four CExecutive counters gate the walk);
 *   - if something changed, exactly the (object, rep, state) triples whose CPU
 *     geometry differs get a bumped version.
 * ------------------------------------------------------------------------- */

struct WebRepVersion {
  unsigned version = 0;
  bool active = false;
  uint64_t sig = 0;
};

struct WebObjectVersion {
  unsigned version = 0;
  int type = 0;
  int n_atom = 0;
  int n_state = 0;
  int enabled = 0;
  uint64_t obj_sig = 0;
  bool seen = false;
  std::map<unsigned, WebRepVersion> reps; // key = state * cRepCnt + rep
};

struct WebVersionCache {
  bool primed = false;
  unsigned counters[4] = {0, 0, 0, 0};
  unsigned serial = 0;
  unsigned walks = 0;
  std::map<std::string, WebObjectVersion> objects;
};

std::map<PyMOLGlobals*, WebVersionCache> g_web_versions;

/// Fold one (state, rep) observation into the cache; @return true if it changed.
bool noteRep(
    WebObjectVersion& O, int state, int rep, bool active, uint64_t sig)
{
  const unsigned key = static_cast<unsigned>(state) * cRepCnt + rep;
  auto it = O.reps.find(key);
  if (it == O.reps.end()) {
    if (!active) {
      return false; // never seen, still absent: say nothing
    }
    O.reps[key] = WebRepVersion{1, true, sig};
    return true;
  }
  if (it->second.active == active && it->second.sig == sig) {
    return false;
  }
  it->second.active = active;
  it->second.sig = sig;
  it->second.version++;
  return true;
}

/* `deep` = re-hash every built Rep's CPU geometry.  See kDeepCounterMask below:
 * when only the *panel* counter moved (which `count_atoms`, `iterate`, `select`
 * and every other SelectorTmp user does on every call) nothing about an existing
 * object's rep geometry can have changed, so the object-level pass alone is run
 * and a 58,870-atom structure costs microseconds instead of 47 ms.  A brand-new
 * object is always walked deep (`O.version == 0`). */
void walkObject(PyMOLGlobals* G, pymol::CObject* base, WebObjectVersion& O,
    bool& changed, bool deep)
{
  const int type = static_cast<int>(base->type);
  uint64_t osig = kFnvOffset;
  hashU64(osig, static_cast<unsigned>(base->Color));
  hashU64(osig, static_cast<unsigned>(base->visRep));
  hashU64(osig, base->ExtentFlag ? 1u : 0u);
  if (base->ExtentFlag) {
    hashFloats(osig, base->ExtentMin, 3);
    hashFloats(osig, base->ExtentMax, 3);
  }
  hashU64(osig, base->TTTFlag ? 1u : 0u);
  if (base->TTTFlag) {
    hashFloats(osig, base->TTT, 16);
  }

  /* Atom/state counts are read before the `deep` gate and are part of the
   * object-level change test in their own right: `remove` can drop an atom that
   * no built rep was drawing, which leaves every rep signature identical. */
  int n_atom = 0;
  int n_state = 0;
  if (auto om = dynamic_cast<ObjectMolecule*>(base)) {
    n_atom = om->NAtom;
    n_state = om->NCSet;
  } else if (auto od = dynamic_cast<ObjectDist*>(base)) {
    n_state = static_cast<int>(od->DSet.size());
  } else if (auto oc = dynamic_cast<ObjectCGO*>(base)) {
    n_state = static_cast<int>(oc->State.size());
  }

  if (O.type != type || O.enabled != base->Enabled || O.obj_sig != osig ||
      O.n_atom != n_atom || O.n_state != n_state) {
    O.type = type;
    O.enabled = base->Enabled;
    O.obj_sig = osig;
    O.n_atom = n_atom;
    O.n_state = n_state;
    changed = true;
  }

  /* extent is derived straight from the AABB, no Rep involved */
  {
    const bool active = (base->visRep & cRepExtentBit) != 0;
    uint64_t sig = kFnvOffset;
    if (active && base->ExtentFlag) {
      hashFloats(sig, base->ExtentMin, 3);
      hashFloats(sig, base->ExtentMax, 3);
      hashFloats(sig, ColorGet(G, base->Color < 0 ? 0 : base->Color), 3);
    }
    changed |= noteRep(O, 0, cRepExtent, active, sig);
  }

  if (!deep) {
    return;
  }

  if (auto obj = dynamic_cast<ObjectMolecule*>(base)) {
    for (int s = 0; s < obj->NCSet; ++s) {
      CoordSet* cs = obj->CSet[s];
      if (!cs) {
        continue;
      }
      for (int r = 0; r < cRepCnt; ++r) {
        if (r == cRepCell || r == cRepExtent) {
          continue;
        }
        ::Rep* rep = cs->Rep[r];
        const bool active = rep && cs->Active[r] && rep->type() == r;
        changed |= noteRep(
            O, s, r, active, active ? repSignature(rep, G) : kFnvOffset);
      }
      /* the unit cell hangs off the CoordSet, not off a Rep slot */
      const bool cell_active =
          (obj->visRep & cRepCellBit) && cs->UnitCellCGO.get();
      changed |= noteRep(O, s, cRepCell, cell_active,
          cell_active ? cgoSignature(cs->UnitCellCGO.get()) : kFnvOffset);
    }
    return;
  }

  if (auto od = dynamic_cast<ObjectDist*>(base)) {
    for (size_t s = 0; s < od->DSet.size(); ++s) {
      DistSet* ds = od->DSet[s].get();
      if (!ds) {
        continue;
      }
      for (int r : {int(cRepDash), int(cRepAngle), int(cRepDihedral)}) {
        ::Rep* rep = ds->Rep[r].get();
        const bool active = rep && rep->type() == r;
        changed |= noteRep(O, static_cast<int>(s), r, active,
            active ? repSignature(rep, G) : kFnvOffset);
      }
    }
    return;
  }

  if (auto oc = dynamic_cast<ObjectCGO*>(base)) {
    for (size_t s = 0; s < oc->State.size(); ++s) {
      const CGO* cgo = oc->State[s].origCGO.get();
      const bool active = cgo != nullptr;
      changed |= noteRep(O, static_cast<int>(s), cRepCGO, active,
          active ? cgoSignature(cgo) : kFnvOffset);
    }
    return;
  }

  /* Any other object type (map, mesh, surface, volume, group, ...): the
   * object-level signature above is all we track.  Documented in
   * docs/webclient/spikes/08-native-changes.md. */
}

} // anonymous namespace

/* ------------------------------------------------------------------------- *
 * _cmd.web_get_rep_geometry(_self._COb, object, state, rep, update=1)
 *
 *   object : object name (molecular objects only for now)
 *   state  : 0-indexed state, or -1 for "current"
 *   rep    : rep name ("cartoon", "surface", "sticks", ...) or rep index
 *   update : if true, run SceneUpdate() first so that reps are built
 *
 * Returns a dict.  `status` is one of:
 *   "ok"              geometry follows
 *   "not-built"       the rep is not shown / not built for this state
 *   "empty"           the rep is built but produced no geometry
 *   "vbo-only"        the CPU copy has been dropped; only GPU buffers remain
 *   "unsupported"     no accessor implemented for this rep / object type
 *   "layout-mismatch" the upstream Rep struct changed under our layout mirror
 *
 * Never returns silently-empty buffers: if the geometry cannot be produced the
 * status says why.
 * ------------------------------------------------------------------------- */
PyObject* CmdWebGetRepGeometry(PyObject* self, PyObject* args)
{
  const char* obj_name = nullptr;
  int state = -1;
  PyObject* rep_arg = nullptr;
  int do_update = 1;

  if (!PyArg_ParseTuple(
          args, "OsiO|i", &self, &obj_name, &state, &rep_arg, &do_update)) {
    return nullptr;
  }

  PyMOLGlobals* G = globalsFromSelf(self);
  if (!G) {
    PyErr_SetString(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_get_rep_geometry: missing PyMOL instance");
    return nullptr;
  }

  /* resolve the rep argument (name or index) while we still hold the GIL and
   * have not entered PyMOL */
  int rep_index = -1;
  if (PyLong_Check(rep_arg)) {
    rep_index = static_cast<int>(PyLong_AsLong(rep_arg));
  } else if (PyUnicode_Check(rep_arg)) {
    const char* rep_name = PyUnicode_AsUTF8(rep_arg);
    if (!rep_name) {
      return nullptr;
    }
    rep_index = repNameToIndex(rep_name);
    if (rep_index < 0) {
      PyErr_Format(P_CmdException ? P_CmdException : PyExc_Exception,
          "web_get_rep_geometry: unknown rep '%s'", rep_name);
      return nullptr;
    }
  } else {
    PyErr_SetString(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_get_rep_geometry: rep must be a string or an int");
    return nullptr;
  }

  if (rep_index < 0 || rep_index >= cRepCnt) {
    PyErr_Format(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_get_rep_geometry: rep index %d out of range", rep_index);
    return nullptr;
  }

  if (PyMOL_GetModalDraw(G->PyMOL)) {
    PyErr_SetString(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_get_rep_geometry: modal draw in progress");
    return nullptr;
  }

  webAPIEnterBlocked(G);

  PyObject* result = nullptr;
  ObjectMolecule* obj = nullptr;
  CoordSet* cs = nullptr;
  int resolved_state = state;

  do {
    auto base = ExecutiveFindObjectByName(G, obj_name);
    if (!base) {
      result = makeResult("unsupported", "no such object");
      break;
    }

    /* Build the reps if asked.  SceneUpdate() is exactly what the exporters and
     * cmd.refresh() use, and it works with no GL context (spike 03 s2). */
    if (do_update) {
      SceneUpdate(G, false);
    }

    /* --- measurement objects: dashes / angles / dihedrals --------------- */
    if (auto od = dynamic_cast<ObjectDist*>(base)) {
      if (resolved_state < 0) {
        resolved_state = od->getCurrentState();
      }
      if (resolved_state < 0 ||
          static_cast<size_t>(resolved_state) >= od->DSet.size() ||
          !od->DSet[resolved_state]) {
        result = makeResult("not-built", "no distance set for this state");
        break;
      }
      DistSet* ds = od->DSet[resolved_state].get();
      if (rep_index != cRepDash && rep_index != cRepAngle &&
          rep_index != cRepDihedral) {
        result = makeResult("unsupported",
            "measurement objects only carry the dashes/angles/dihedrals reps");
        break;
      }
      ::Rep* rep = ds->Rep[rep_index].get();
      if (!rep) {
        result = makeResult("not-built",
            "measurement rep is not built for this object/state");
        break;
      }
      if (rep->type() != rep_index) {
        result = makeResult("layout-mismatch",
            "Rep::type() disagrees with its slot in DistSet::Rep");
        break;
      }
      result = extractDistLines(rep, G, ds,
          rep_index == cRepDash
              ? "RepDistDash::V"
              : (rep_index == cRepAngle ? "RepAngle::V" : "RepDihedral::V"));
      break;
    }

    /* --- standalone CGO objects ---------------------------------------- */
    if (auto oc = dynamic_cast<ObjectCGO*>(base)) {
      if (rep_index != cRepCGO && rep_index != cRepExtent) {
        result = makeResult("unsupported",
            "CGO objects only carry the cgo and extent reps");
        break;
      }
      if (rep_index == cRepExtent) {
        result = extractExtent(base, G);
        break;
      }
      if (resolved_state < 0) {
        resolved_state = oc->getCurrentState();
      }
      if (resolved_state < 0 ||
          static_cast<size_t>(resolved_state) >= oc->State.size()) {
        result = makeResult("not-built", "no CGO state");
        break;
      }
      result = extractBareCGO(
          oc->State[resolved_state].origCGO.get(), G, "ObjectCGO::origCGO");
      break;
    }

    obj = dynamic_cast<ObjectMolecule*>(base);
    if (!obj) {
      result = makeResult("unsupported",
          "no CPU-side geometry accessor for this object type (molecular, "
          "measurement and CGO objects are supported)");
      break;
    }

    /* --- extent: an AABB, no Rep involved ------------------------------ */
    if (rep_index == cRepExtent) {
      result = extractExtent(base, G);
      break;
    }

    if (resolved_state < 0) {
      resolved_state = obj->getCurrentState();
    }
    cs = obj->getCoordSet(resolved_state);
    if (!cs) {
      result = makeResult("not-built", "no coordinate set for this state");
      break;
    }

    /* --- unit cell: CoordSet::UnitCellCGO, not a Rep slot --------------- */
    if (rep_index == cRepCell) {
      if (!(obj->visRep & cRepCellBit)) {
        result = makeResult("not-built", "cell rep is not shown for this object");
      } else {
        result =
            extractBareCGO(cs->UnitCellCGO.get(), G, "CoordSet::UnitCellCGO");
      }
      break;
    }

    ::Rep* rep = cs->Rep[rep_index];
    if (!rep || !cs->Active[rep_index]) {
      result = makeResult("not-built",
          "rep is not shown or not built for this object/state (show it, then "
          "call cmd.refresh() or pass update=1)");
      break;
    }
    if (rep->type() != rep_index) {
      result = makeResult("layout-mismatch",
          "Rep::type() disagrees with its slot in CoordSet::Rep");
      break;
    }

    switch (rep_index) {
    case cRepSurface:
      result = extractSurface(rep, G, obj);
      break;
    case cRepDot:
      result = extractDots(rep, G);
      break;
    case cRepMesh:
      result = extractMesh(rep, G);
      break;
    default:
      result = extractCGORep(rep, G);
      break;
    }
  } while (false);

  webAPIExitBlocked(G);

  if (!result) {
    result = makeResult("unsupported", "no result produced");
  }

  /* common identity keys - this is what makes the payload cacheable client-side */
  dictSetStr(result, "object", obj_name);
  dictSetInt(result, "state", resolved_state);
  dictSetStr(result, "rep", repIndexToName(rep_index));
  dictSetInt(result, "rep_index", rep_index);
  dictSetInt(result, "n_atom", obj ? obj->NAtom : 0);
  {
    char key[512];
    snprintf(key, sizeof(key), "%s|%s|%d", obj_name, repIndexToName(rep_index),
        resolved_state);
    dictSetStr(result, "key", key);
  }
  return result;
}

/* ------------------------------------------------------------------------- *
 * _cmd.web_get_versions(_self._COb, update=1, force=0)
 *
 * Exact change detection for Mode G (implementation plan 03 s4 Task 6).
 *
 * Returns:
 *   {
 *     "counters":   [panel, enable, name, rep]   # struct CExecutive, monotonic
 *     "serial":     N        # bumps iff some version below bumped
 *     "recomputed": bool     # false = fast path, not one Rep was touched
 *     "walks":      N        # how many full walks this instance has ever done
 *     "objects": {
 *        "<name>": {
 *            "version": N, "type": int, "enabled": bool,
 *            "n_atom": int, "n_state": int,
 *            "reps": { "<rep>|<state>": {"version": N, "active": bool}, ... }
 *        }, ...
 *     }
 *   }
 *
 * A rep entry appears once it has ever been active; when it goes away it stays
 * in the map with active=false and a bumped version, which is exactly the signal
 * defect D1 needs ("hide everything; show sticks" must drop the stale cartoon).
 *
 * Cost model: if the four counters are unchanged the call returns the cached
 * answer and dereferences no Rep pointer, so an idle poll cannot report a
 * phantom change.  When they have changed the walk hashes the CPU geometry of
 * every built rep - which is the same moment the client is about to refetch it.
 * ------------------------------------------------------------------------- */
PyObject* CmdWebGetVersions(PyObject* self, PyObject* args)
{
  int do_update = 1;
  int force = 0;

  if (!PyArg_ParseTuple(args, "O|ii", &self, &do_update, &force)) {
    return nullptr;
  }

  PyMOLGlobals* G = globalsFromSelf(self);
  if (!G) {
    PyErr_SetString(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_get_versions: missing PyMOL instance");
    return nullptr;
  }
  if (PyMOL_GetModalDraw(G->PyMOL)) {
    PyErr_SetString(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_get_versions: modal draw in progress");
    return nullptr;
  }

  webAPIEnterBlocked(G);

  WebVersionCache& C = g_web_versions[G];

  unsigned counters[4] = {0, 0, 0, 0};
  ExecutiveWebGetChangeCounters(G, counters);

  bool need_walk = force || !C.primed;
  for (int i = 0; i < 4 && !need_walk; ++i) {
    need_walk = counters[i] != C.counters[i];
  }

  /* MEASURED AND REJECTED: gating the per-Rep hashing on counters 1..3 only
   * (skipping it when just the *panel* counter moved, which count_atoms /
   * iterate / select / get_model all do) turned a 47 ms walk on 1AON into
   * microseconds.  A differential harness - 400 random commands, one instance
   * gated and one forced - diverged 8 times, always after `create <name>` onto
   * an EXISTING object name, whose atom count changed with no counter but the
   * panel one moving.  That is precisely a D1-class stale-geometry hole, so the
   * conservative "any counter -> full re-hash" rule stands.  See
   * docs/webclient/spikes/08-native-changes.md s2.5. */
  const bool deep = true;

  /* SceneUpdate() is what actually rebuilds an invalidated rep.  Run it only
   * when a counter says something is pending, so an idle poll stays free. */
  if (need_walk && do_update) {
    SceneUpdate(G, false);
    /* the rebuild itself can bump counters (side-effect settings); re-read so
     * the next poll compares against a post-update baseline */
    ExecutiveWebGetChangeCounters(G, counters);
  }

  bool changed = false;
  if (need_walk) {
    C.walks++;
    for (auto& kv : C.objects) {
      kv.second.seen = false;
    }
    for (ObjectIterator iter(G); iter.next();) {
      pymol::CObject* base = iter.getObject();
      if (!base) {
        continue;
      }
      WebObjectVersion& O = C.objects[base->Name];
      const bool fresh = O.version == 0;
      O.seen = true;
      bool obj_changed = fresh;
      walkObject(G, base, O, obj_changed, deep || fresh);
      if (obj_changed) {
        O.version++;
        changed = true;
      }
    }
    for (auto it = C.objects.begin(); it != C.objects.end();) {
      if (!it->second.seen) {
        it = C.objects.erase(it);
        changed = true;
      } else {
        ++it;
      }
    }
    if (changed) {
      C.serial++;
    }
    std::memcpy(C.counters, counters, sizeof(counters));
    C.primed = true;
  }

  webAPIExitBlocked(G);

  PyObject* d = PyDict_New();
  {
    PyObject* l = PyList_New(4);
    for (int i = 0; i < 4; ++i) {
      PyList_SetItem(l, i, PyLong_FromUnsignedLong(C.counters[i]));
    }
    dictSet(d, "counters", l);
  }
  dictSetInt(d, "serial", C.serial);
  dictSet(d, "recomputed", PyBool_FromLong(need_walk));
  dictSet(d, "rehashed", PyBool_FromLong(need_walk && deep));
  dictSet(d, "changed", PyBool_FromLong(changed));
  dictSetInt(d, "walks", C.walks);

  PyObject* objects = PyDict_New();
  for (const auto& kv : C.objects) {
    const WebObjectVersion& O = kv.second;
    PyObject* od = PyDict_New();
    dictSetInt(od, "version", O.version);
    dictSetInt(od, "type", O.type);
    dictSet(od, "enabled", PyBool_FromLong(O.enabled));
    dictSetInt(od, "n_atom", O.n_atom);
    dictSetInt(od, "n_state", O.n_state);

    PyObject* reps = PyDict_New();
    for (const auto& rkv : O.reps) {
      const int state = static_cast<int>(rkv.first / cRepCnt);
      const int rep = static_cast<int>(rkv.first % cRepCnt);
      char key[64];
      snprintf(key, sizeof(key), "%s|%d", repIndexToName(rep), state);
      PyObject* rd = PyDict_New();
      dictSetInt(rd, "version", rkv.second.version);
      dictSet(rd, "active", PyBool_FromLong(rkv.second.active));
      PyDict_SetItemString(reps, key, rd);
      Py_DECREF(rd);
    }
    dictSet(od, "reps", reps);
    PyDict_SetItemString(objects, kv.first.c_str(), od);
    Py_DECREF(od);
  }
  dictSet(d, "objects", objects);
  return d;
}

/* ------------------------------------------------------------------------- *
 * _cmd.web_resolve_pick(_self._COb, object, index, bond, state=-1)
 *
 * Implementation plan 03 s4 Task 3, the client-side-picking half.
 *
 * The geometry payload already carries, per vertex and per instance, the
 * (index, bond) pair that sat behind CGO_PICK_COLOR (layer1/CGO.h:150-151).
 * `index` is the 0-based atom index inside the object -- the SAME value the GL
 * pick pass ends up putting in Picking::src.index, which layer1/SceneMouse.cpp
 * turns into a selection with `"%s`%d" % (obj->Name, index + 1)` (:245).
 * `bond` is cPickableAtom / cPickableNoPick or a 0-based bond index.
 *
 * The pick COLOUR is deliberately NOT shipped: PickColorManager::colorNext
 * (layer1/Picking.cpp:150-186) is a per-frame draw-order counter whose reverse
 * map holds raw CObject* and is invalidated on every rebuild.
 *
 * This call is the client's resolver and needs no GL context at all.
 * ------------------------------------------------------------------------- */
PyObject* CmdWebResolvePick(PyObject* self, PyObject* args)
{
  const char* obj_name = nullptr;
  int index = -1;
  int bond = cPickableAtom;
  int state = -1;

  if (!PyArg_ParseTuple(
          args, "Osi|ii", &self, &obj_name, &index, &bond, &state)) {
    return nullptr;
  }

  PyMOLGlobals* G = globalsFromSelf(self);
  if (!G) {
    PyErr_SetString(P_CmdException ? P_CmdException : PyExc_Exception,
        "web_resolve_pick: missing PyMOL instance");
    return nullptr;
  }

  webAPIEnterBlocked(G);

  PyObject* result = nullptr;

  do {
    auto base = ExecutiveFindObjectByName(G, obj_name);
    if (!base) {
      result = makeResult("unsupported", "no such object");
      break;
    }
    auto obj = dynamic_cast<ObjectMolecule*>(base);
    if (!obj) {
      result = makeResult("unsupported",
          "web_resolve_pick only resolves picks on molecular objects");
      break;
    }
    if (bond == cPickableNoPick) {
      result = makeResult("no-pick",
          "this vertex was emitted with cPickableNoPick (masked atom); it "
          "blocks the pick but selects nothing");
      break;
    }
    if (index < 0 || index >= obj->NAtom) {
      result = makeResult("unsupported", "atom index out of range");
      break;
    }

    if (state < 0) {
      state = obj->getCurrentState();
    }

    result = makeResult("ok", "");
    dictSetStr(result, "object", obj->Name);
    dictSetInt(result, "index", index);
    dictSetInt(result, "bond", bond);
    dictSetInt(result, "state", state);

    /* Exactly what layer1/SceneMouse.cpp:245 builds for a real backend pick. */
    {
      char sele[WordLength + 24];
      snprintf(sele, sizeof(sele), "%s`%d", obj->Name, index + 1);
      dictSetStr(result, "selection", sele);
    }

    {
      auto desc = obj->describeElement(index);
      dictSetStr(result, "describe", desc.c_str());
    }

    const AtomInfoType* ai = obj->AtomInfo + index;
    PyObject* atom = PyDict_New();
    dictSetStr(atom, "name", LexStr(G, ai->name));
    dictSetStr(atom, "resn", LexStr(G, ai->resn));
    {
      char resi[8] = "";
      AtomResiFromResv(resi, sizeof(resi), ai);
      dictSetStr(atom, "resi", resi);
    }
    dictSetInt(atom, "resv", ai->resv);
    dictSetStr(atom, "chain", LexStr(G, ai->chain));
    dictSetStr(atom, "segi", LexStr(G, ai->segi));
    dictSetStr(atom, "elem", ai->elem);
    dictSetInt(atom, "rank", ai->rank);
    dictSetInt(atom, "id", ai->id);
    dictSetInt(atom, "index1", index + 1);
    dictSet(atom, "masked", PyBool_FromLong(ai->masked));
    dictSetFloat(atom, "b", ai->b);
    dictSetFloat(atom, "q", ai->q);
    dictSet(result, "atom", atom);

    float v[3];
    if (ObjectMoleculeGetAtomTxfVertex(obj, state, index, v)) {
      PyObject* c = PyList_New(3);
      for (int i = 0; i < 3; ++i) {
        PyList_SetItem(c, i, PyFloat_FromDouble(v[i]));
      }
      dictSet(result, "coord", c);
    } else {
      Py_INCREF(Py_None);
      dictSet(result, "coord", Py_None);
    }

    /* A half-bond pick: report both ends so the client can highlight the bond
     * rather than a single atom. */
    if (bond >= 0 && bond < obj->NBond) {
      const BondType* b = obj->Bond + bond;
      PyObject* pair = PyList_New(2);
      PyList_SetItem(pair, 0, PyLong_FromLong(b->index[0]));
      PyList_SetItem(pair, 1, PyLong_FromLong(b->index[1]));
      dictSet(result, "bond_atoms", pair);
      char sele[WordLength * 2 + 48];
      snprintf(sele, sizeof(sele), "(%s`%d or %s`%d)", obj->Name,
          b->index[0] + 1, obj->Name, b->index[1] + 1);
      dictSetStr(result, "bond_selection", sele);
    } else {
      Py_INCREF(Py_None);
      dictSet(result, "bond_atoms", Py_None);
    }
    dictSetStr(result, "pick_kind",
        (bond == cPickableAtom) ? "atom" : (bond >= 0 ? "bond" : "other"));
  } while (false);

  webAPIExitBlocked(G);

  if (!result) {
    result = makeResult("unsupported", "no result produced");
  }
  return result;
}
