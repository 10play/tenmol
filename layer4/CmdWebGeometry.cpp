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
 */

#include "os_python.h"

#include <cstdint>
#include <cstring>
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
#include "CoordSet.h"
#include "Rep.h"
#include "CGO.h"
#include "Color.h"
#include "Scene.h"
#include "Setting.h"
#include "RepSphere.h"
#include "RepDot.h"

/* Declared here (rather than in a header we do not own) so that layer4/Cmd.cpp
 * needs only a one-line forward declaration next to its method table. */
PyObject* CmdWebGetRepGeometry(PyObject* self, PyObject* args);

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
    obj = dynamic_cast<ObjectMolecule*>(base);
    if (!obj) {
      result = makeResult("unsupported",
          "only molecular objects are supported by this accessor");
      break;
    }

    /* Build the reps if asked.  SceneUpdate() is exactly what the exporters and
     * cmd.refresh() use, and it works with no GL context (spike 03 s2). */
    if (do_update) {
      SceneUpdate(G, false);
    }

    if (resolved_state < 0) {
      resolved_state = obj->getCurrentState();
    }
    cs = obj->getCoordSet(resolved_state);
    if (!cs) {
      result = makeResult("not-built", "no coordinate set for this state");
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
