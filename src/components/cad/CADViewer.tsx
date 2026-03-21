import { useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Center, Float, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { motion } from 'framer-motion';
import { Box, Layers, Eye, RotateCcw, ZoomIn, ZoomOut, Maximize2, Download, Cpu } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { extractFeaturesFromScene, featureSetToDownloadUrl } from '@/lib/geometry/sceneExtractor';
import * as THREE from 'three';
function IndustrialModel() {
  const viewMode = useAppStore((s) => s.viewMode);

  return (
    <Center>
      <Float speed={0.4} rotationIntensity={0.1} floatIntensity={0.3}>
        <group>
          {/* Main housing */}
          <mesh position={[0, 0, 0]} castShadow>
            <cylinderGeometry args={[1.2, 1.4, 2, 32]} />
            <meshStandardMaterial
              color="#4a9eff"
              metalness={0.85}
              roughness={0.15}
              wireframe={viewMode === 'wireframe'}
              transparent={viewMode === 'xray'}
              opacity={viewMode === 'xray' ? 0.3 : 1}
            />
          </mesh>

          {/* Top flange */}
          <mesh position={[0, 1.15, 0]} castShadow>
            <cylinderGeometry args={[1.5, 1.5, 0.3, 32]} />
            <meshStandardMaterial
              color="#3d8bdb"
              metalness={0.9}
              roughness={0.1}
              wireframe={viewMode === 'wireframe'}
              transparent={viewMode === 'xray'}
              opacity={viewMode === 'xray' ? 0.25 : 1}
            />
          </mesh>

          {/* Bottom flange */}
          <mesh position={[0, -1.15, 0]} castShadow>
            <cylinderGeometry args={[1.6, 1.6, 0.3, 32]} />
            <meshStandardMaterial
              color="#3d8bdb"
              metalness={0.9}
              roughness={0.1}
              wireframe={viewMode === 'wireframe'}
              transparent={viewMode === 'xray'}
              opacity={viewMode === 'xray' ? 0.25 : 1}
            />
          </mesh>

          {/* Internal impeller */}
          <mesh position={[0, 0, 0]} castShadow>
            <torusGeometry args={[0.6, 0.15, 8, 24]} />
            <meshStandardMaterial
              color="#10b981"
              metalness={0.7}
              roughness={0.2}
              wireframe={viewMode === 'wireframe'}
              transparent={viewMode === 'xray'}
              opacity={viewMode === 'xray' ? 0.6 : 1}
              emissive="#10b981"
              emissiveIntensity={viewMode === 'xray' ? 0.3 : 0}
            />
          </mesh>

          {/* Inlet pipe */}
          <mesh position={[1.8, 0.3, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.35, 0.35, 1.2, 16]} />
            <meshStandardMaterial
              color="#6b7280"
              metalness={0.8}
              roughness={0.2}
              wireframe={viewMode === 'wireframe'}
              transparent={viewMode === 'xray'}
              opacity={viewMode === 'xray' ? 0.3 : 1}
            />
          </mesh>

          {/* Bolts */}
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

/** Captures the scene ref so we can extract geometry from outside the canvas. */
function SceneCapture({ sceneRef }: { sceneRef: React.MutableRefObject<THREE.Scene | null> }) {
  const { scene } = useThree();
  sceneRef.current = scene;
  return null;
}

const toolbarButtons = [
  { icon: RotateCcw, label: 'Reset' },
  { icon: ZoomIn, label: 'Zoom In' },
  { icon: ZoomOut, label: 'Zoom Out' },
  { icon: Maximize2, label: 'Fit' },
];

export function CADViewer() {
  const { viewMode, setViewMode, setExtractedFeatures, extractedFeatures, uploadedFile } = useAppStore();
  const sceneRef = useRef<THREE.Scene | null>(null);

  const handleExtractFeatures = useCallback(() => {
    if (!sceneRef.current) return;
    const features = extractFeaturesFromScene(sceneRef.current);
    if (features) {
      setExtractedFeatures(features);
      // Auto-download JSON
      const url = featureSetToDownloadUrl(features, uploadedFile?.name || 'model');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(uploadedFile?.name || 'model').replace(/\.\w+$/, '')}_features.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [setExtractedFeatures, uploadedFile]);

  return (
    <div className="flex-1 relative bg-background industrial-grid overflow-hidden">
      {/* 3D Canvas */}
      <Canvas
        shadows
        camera={{ position: [5, 3, 5], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: 'transparent' }}
      >
        <color attach="background" args={['#0B0F14']} />
        <fog attach="fog" args={['#0B0F14', 8, 20]} />

        <ambientLight intensity={0.15} />
        <directionalLight position={[5, 8, 5]} intensity={1} castShadow shadow-mapSize={2048} />
        <pointLight position={[-3, 2, -3]} intensity={0.4} color="#4a9eff" />
        <pointLight position={[3, -1, 2]} intensity={0.2} color="#10b981" />

        <IndustrialModel />
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
          enableDamping
          dampingFactor={0.05}
          minDistance={3}
          maxDistance={12}
          maxPolarAngle={Math.PI / 1.8}
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

      {/* Side toolbar */}
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
        className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-card/90 backdrop-blur-sm border border-border rounded-lg p-1"
      >
        {toolbarButtons.map((btn) => (
          <button
            key={btn.label}
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
            {uploadedFile?.name || 'Turbine_Housing_v4.step'}
          </p>
          <p className="text-xs font-mono text-primary">
            {extractedFeatures
              ? `Faces: ${extractedFeatures.stats.totalFaces.toLocaleString()} · Edges: ${extractedFeatures.stats.totalEdges.toLocaleString()} · Vol: ${extractedFeatures.stats.volume.toFixed(1)}`
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
    </div>
  );
}
