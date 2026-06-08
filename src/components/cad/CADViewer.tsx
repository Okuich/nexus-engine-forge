import { useRef, useCallback, useMemo, useState } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Center, Float, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Layers, Eye, RotateCcw, ZoomIn, ZoomOut, Maximize2, Download, Cpu, MousePointer2, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { extractFeaturesFromScene, featureSetToDownloadUrl } from '@/lib/geometry/sceneExtractor';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// ─── STL Parser ──────────────────────────────────────────────────

export function parseSTLFile(file: File): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const loader = new STLLoader();
        const geometry = loader.parse(e.target!.result as ArrayBuffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        resolve(geometry);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Uploaded Mesh with Face Selection ───────────────────────────

function UploadedModel() {
  const viewMode = useAppStore((s) => s.viewMode);
  const geometry = useAppStore((s) => s.loadedGeometry);
  const selectedFaceIndex = useAppStore((s) => s.selectedFaceIndex);
  const setSelectedFaceIndex = useAppStore((s) => s.setSelectedFaceIndex);
  const meshRef = useRef<THREE.Mesh>(null);

  // Build per-face color attribute for highlighting
  const coloredGeometry = useMemo(() => {
    if (!geometry) return null;
    const geo = geometry.clone();
    const posAttr = geo.getAttribute('position');
    const faceCount = posAttr.count / 3;
    const colors = new Float32Array(posAttr.count * 3);

    for (let f = 0; f < faceCount; f++) {
      const isSelected = selectedFaceIndex === f;
      const r = isSelected ? 0.1 : 0.29;
      const g = isSelected ? 0.95 : 0.62;
      const b = isSelected ? 0.4 : 1.0;
      for (let v = 0; v < 3; v++) {
        colors[(f * 3 + v) * 3 + 0] = r;
        colors[(f * 3 + v) * 3 + 1] = g;
        colors[(f * 3 + v) * 3 + 2] = b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [geometry, selectedFaceIndex]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.faceIndex !== undefined) {
      setSelectedFaceIndex(e.faceIndex);
    }
  }, [setSelectedFaceIndex]);

  if (!coloredGeometry) return null;

  return (
    <Center>
      <mesh
        ref={meshRef}
        geometry={coloredGeometry}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          vertexColors
          metalness={0.8}
          roughness={0.2}
          wireframe={viewMode === 'wireframe'}
          transparent={viewMode === 'xray'}
          opacity={viewMode === 'xray' ? 0.35 : 1}
          side={THREE.DoubleSide}
        />
      </mesh>
    </Center>
  );
}

// ─── Default Demo Model ──────────────────────────────────────────

function DemoModel() {
  const viewMode = useAppStore((s) => s.viewMode);

  const matProps = useMemo(() => ({
    wireframe: viewMode === 'wireframe',
    transparent: viewMode === 'xray',
    opacity: viewMode === 'xray' ? 0.3 : 1,
  }), [viewMode]);

  return (
    <Center>
      <Float speed={0.4} rotationIntensity={0.1} floatIntensity={0.3}>
        <group>
          <mesh position={[0, 0, 0]} castShadow>
            <cylinderGeometry args={[1.2, 1.4, 2, 32]} />
            <meshStandardMaterial color="#4a9eff" metalness={0.85} roughness={0.15} {...matProps} />
          </mesh>
          <mesh position={[0, 1.15, 0]} castShadow>
            <cylinderGeometry args={[1.5, 1.5, 0.3, 32]} />
            <meshStandardMaterial color="#3d8bdb" metalness={0.9} roughness={0.1} {...matProps} />
          </mesh>
          <mesh position={[0, -1.15, 0]} castShadow>
            <cylinderGeometry args={[1.6, 1.6, 0.3, 32]} />
            <meshStandardMaterial color="#3d8bdb" metalness={0.9} roughness={0.1} {...matProps} />
          </mesh>
          <mesh position={[0, 0, 0]} castShadow>
            <torusGeometry args={[0.6, 0.15, 8, 24]} />
            <meshStandardMaterial
              color="#10b981" metalness={0.7} roughness={0.2}
              emissive="#10b981" emissiveIntensity={viewMode === 'xray' ? 0.3 : 0}
              {...matProps} opacity={viewMode === 'xray' ? 0.6 : 1}
            />
          </mesh>
          <mesh position={[1.8, 0.3, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.35, 0.35, 1.2, 16]} />
            <meshStandardMaterial color="#6b7280" metalness={0.8} roughness={0.2} {...matProps} />
          </mesh>
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(angle) * 1.35, 1.3, Math.sin(angle) * 1.35]} castShadow>
                <cylinderGeometry args={[0.06, 0.06, 0.15, 6]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.05} wireframe={viewMode === 'wireframe'} />
              </mesh>
            );
          })}
        </group>
      </Float>
    </Center>
  );
}

// ─── Scene Capture & Camera Controls ─────────────────────────────

function SceneCapture({ sceneRef }: { sceneRef: React.MutableRefObject<THREE.Scene | null> }) {
  const { scene } = useThree();
  sceneRef.current = scene;
  return null;
}

function CameraController({ controlsRef }: { controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();
  // Expose camera for toolbar
  useFrame(() => {
    if (controlsRef.current) controlsRef.current.update();
  });
  return null;
}

// ─── Selection Info HUD ──────────────────────────────────────────

function SelectionHUD() {
  const selectedFaceIndex = useAppStore((s) => s.selectedFaceIndex);
  const setSelectedFaceIndex = useAppStore((s) => s.setSelectedFaceIndex);
  const geometry = useAppStore((s) => s.loadedGeometry);

  if (selectedFaceIndex === null || !geometry) return null;

  const posAttr = geometry.getAttribute('position');
  const faceCount = posAttr.count / 3;

  // Compute face normal and area
  const i0 = selectedFaceIndex * 3;
  const a = new THREE.Vector3(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
  const b = new THREE.Vector3(posAttr.getX(i0 + 1), posAttr.getY(i0 + 1), posAttr.getZ(i0 + 1));
  const c = new THREE.Vector3(posAttr.getX(i0 + 2), posAttr.getY(i0 + 2), posAttr.getZ(i0 + 2));
  const edge1 = b.clone().sub(a);
  const edge2 = c.clone().sub(a);
  const cross = edge1.cross(edge2);
  const area = cross.length() / 2;
  const normal = cross.normalize();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-primary/30 rounded-xl p-4 min-w-[220px] shadow-lg shadow-primary/10"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MousePointer2 className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Selected Face</span>
        </div>
        <button
          onClick={() => setSelectedFaceIndex(null)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1.5 text-xs font-mono">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Face</span>
          <span className="text-foreground">{selectedFaceIndex} / {faceCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Area</span>
          <span className="text-foreground">{area.toFixed(4)} mm²</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Normal</span>
          <span className="text-foreground">[{normal.x.toFixed(2)}, {normal.y.toFixed(2)}, {normal.z.toFixed(2)}]</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Viewer ─────────────────────────────────────────────────

export function CADViewer() {
  const { viewMode, setViewMode, setExtractedFeatures, extractedFeatures, uploadedFile, loadedGeometry, setSelectedFaceIndex } = useAppStore();
  const sceneRef = useRef<THREE.Scene | null>(null);
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const handleExtractFeatures = useCallback(() => {
    if (!sceneRef.current) return;
    const features = extractFeaturesFromScene(sceneRef.current);
    if (features) {
      setExtractedFeatures(features);
      const url = featureSetToDownloadUrl(features, uploadedFile?.name || 'model');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(uploadedFile?.name || 'model').replace(/\.\w+$/, '')}_features.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [setExtractedFeatures, uploadedFile]);

  const handleReset = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }, []);

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const factor = direction === 'in' ? 0.75 : 1.4;
    const camera = controls.object as THREE.PerspectiveCamera;
    const target = controls.target as THREE.Vector3;
    const offset = camera.position.clone().sub(target);
    offset.multiplyScalar(factor);
    camera.position.copy(target.clone().add(offset));
    controls.update();
  }, []);

  const handleFit = useCallback(() => {
    if (!sceneRef.current || !controlsRef.current) return;
    const box = new THREE.Box3().setFromObject(sceneRef.current);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const camera = controlsRef.current.object as THREE.PerspectiveCamera;
    const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  }, []);

  const toolbarActions = [
    { icon: RotateCcw, label: 'Reset', action: handleReset },
    { icon: ZoomIn, label: 'Zoom In', action: () => handleZoom('in') },
    { icon: ZoomOut, label: 'Zoom Out', action: () => handleZoom('out') },
    { icon: Maximize2, label: 'Fit', action: handleFit },
  ];

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    // Deselect if clicking on empty space (not on a mesh)
    // This is handled by the mesh's stopPropagation
  }, []);

  return (
    <div className="flex-1 relative bg-background industrial-grid overflow-hidden">
      {/* 3D Canvas */}
      <Canvas
        shadows
        camera={{ position: [5, 3, 5], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: 'transparent' }}
        onPointerMissed={() => setSelectedFaceIndex(null)}
      >
        <color attach="background" args={['#0B0F14']} />
        <fog attach="fog" args={['#0B0F14', 8, 20]} />

        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow shadow-mapSize={2048} />
        <directionalLight position={[-4, 3, -3]} intensity={0.3} />
        <pointLight position={[-3, 2, -3]} intensity={0.4} color="#4a9eff" />
        <pointLight position={[3, -1, 2]} intensity={0.2} color="#10b981" />

        {loadedGeometry ? <UploadedModel /> : <DemoModel />}
        <SceneCapture sceneRef={sceneRef} />

        <Grid
          position={[0, -1.5, 0]}
          args={[20, 20]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#1a2332"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#1e3a5f"
          fadeDistance={15}
          fadeStrength={1}
          infiniteGrid
        />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.05}
          minDistance={1}
          maxDistance={50}
          maxPolarAngle={Math.PI / 1.5}
        />

        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.7} />
        </GizmoHelper>

        <Environment preset="city" />
      </Canvas>

      {/* View mode toolbar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="absolute top-4 left-4 flex items-center gap-1 bg-card/90 backdrop-blur-sm border border-border rounded-lg p-1"
      >
        {[
          { mode: 'solid' as const, icon: Box, label: 'Solid' },
          { mode: 'wireframe' as const, icon: Layers, label: 'Wire' },
          { mode: 'xray' as const, icon: Eye, label: 'X-Ray' },
        ].map((item) => (
          <button
            key={item.mode}
            onClick={() => setViewMode(item.mode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === item.mode
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        ))}
      </motion.div>

      {/* Side toolbar — now functional */}
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
        className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-card/90 backdrop-blur-sm border border-border rounded-lg p-1"
      >
        {toolbarActions.map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={btn.label}
          >
            <btn.icon className="w-4 h-4" />
          </button>
        ))}
      </motion.div>

      {/* Model info + Extract button */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="absolute bottom-4 left-4 flex items-end gap-2"
      >
        <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2.5">
          <p className="text-xs font-mono text-muted-foreground">
            {uploadedFile?.name || 'Drop a CAD file to analyze'}
          </p>
          <p className="text-xs font-mono text-primary">
            {extractedFeatures
              ? `Faces: ${extractedFeatures.stats.totalFaces.toLocaleString()} · Edges: ${extractedFeatures.stats.totalEdges.toLocaleString()} · Vol: ${extractedFeatures.stats.volume.toFixed(1)}`
              : loadedGeometry
              ? `Vertices: ${loadedGeometry.getAttribute('position').count.toLocaleString()} · Faces: ${(loadedGeometry.getAttribute('position').count / 3).toLocaleString()}`
              : 'Vertices: 24,847 · Faces: 49,692'}
          </p>
        </div>
        <button
          onClick={handleExtractFeatures}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
        >
          <Cpu className="w-3.5 h-3.5" />
          Extract Features
          <Download className="w-3 h-3 opacity-60" />
        </button>
      </motion.div>

      {/* Selection HUD */}
      <SelectionHUD />
    </div>
  );
}
