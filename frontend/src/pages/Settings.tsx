'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  loadViewerSettings,
  saveViewerSettings,
  type ViewerSettings,
} from '@/lib/viewerSettings';
import { VIEWER_SCENE_SCALE_MIN, VIEWER_SCENE_SCALE_MAX } from '@/viewer/constants';

export default function Settings() {
  const [settings, setSettings] = useState<ViewerSettings>(() => loadViewerSettings());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  const handleSave = () => {
    const clamped: ViewerSettings = {
      ...settings,
      sceneScale: Math.max(VIEWER_SCENE_SCALE_MIN, Math.min(VIEWER_SCENE_SCALE_MAX, settings.sceneScale)),
    };
    saveViewerSettings(clamped);
    setSettings(clamped);
    setSaved(true);
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white">Settings</h2>
        <p className="text-gray-500 text-sm mt-1">Viewer defaults stored in your browser.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3D Viewer</CardTitle>
          <CardDescription>Lighting and scene scale for GLB meshes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm text-gray-400">
            Scene scale
            <input
              type="range"
              min={VIEWER_SCENE_SCALE_MIN}
              max={VIEWER_SCENE_SCALE_MAX}
              step={0.05}
              value={settings.sceneScale}
              onChange={(e) => setSettings((s) => ({ ...s, sceneScale: parseFloat(e.target.value) }))}
              className="w-full mt-1 accent-white"
            />
            <span className="text-xs text-white/60">{settings.sceneScale.toFixed(2)}×</span>
          </label>

          <label className="block text-sm text-gray-400">
            Ambient light
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.lighting.hemiIntensity}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  lighting: { ...s.lighting, hemiIntensity: parseFloat(e.target.value) },
                }))
              }
              className="w-full mt-1 accent-white"
            />
          </label>

          <label className="block text-sm text-gray-400">
            Directional light
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.lighting.dirIntensity}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  lighting: { ...s.lighting, dirIntensity: parseFloat(e.target.value) },
                }))
              }
              className="w-full mt-1 accent-white"
            />
          </label>

          <label className="block text-sm text-gray-400">
            Environment intensity
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.lighting.envIntensity}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  lighting: { ...s.lighting, envIntensity: parseFloat(e.target.value) },
                }))
              }
              className="w-full mt-1 accent-white"
            />
          </label>

          <Button onClick={handleSave} className="w-full">
            {saved ? 'Saved' : 'Save defaults'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
