import {
  Camera,
  Footprints,
  Glasses,
  Info,
  MousePointer,
  RotateCcw,
  Ruler,
  X,
} from 'lucide-react';
import type { ViewerMode } from '../types';

export interface ViewerToolbarProps {
  mode: ViewerMode;
  autoRotate: boolean;
  showHelp: boolean;
  webXrAvailable: boolean;
  webXrBusy: boolean;
  onModeChange: (mode: ViewerMode) => void;
  onSnapshot: () => void;
  onReset: () => void;
  onToggleAutoRotate: () => void;
  onEnterVR: () => void;
  onToggleHelp: () => void;
}

export function ViewerToolbar({
  mode,
  autoRotate,
  showHelp,
  webXrAvailable,
  webXrBusy,
  onModeChange,
  onSnapshot,
  onReset,
  onToggleAutoRotate,
  onEnterVR,
  onToggleHelp,
}: ViewerToolbarProps) {
  return (
    <>
      <div className="absolute top-3 left-3 z-10">
        <div className="glass-panel text-white/80 text-xs px-3 py-1.5 flex items-center gap-2">
          {mode === 'orbit' && <><MousePointer className="w-3 h-3" /> Orbit</>}
          {mode === 'walkthrough' && <><Footprints className="w-3 h-3" /> Walk-Through</>}
          {mode === 'measure' && <><Ruler className="w-3 h-3" /> Measure</>}
        </div>
      </div>

      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <ToolbarButton icon={<MousePointer className="w-3.5 h-3.5" />} label="Orbit" active={mode === 'orbit'} onClick={() => onModeChange('orbit')} />
        <ToolbarButton icon={<Footprints className="w-3.5 h-3.5" />} label="Walk" active={mode === 'walkthrough'} onClick={() => onModeChange('walkthrough')} />
        <ToolbarButton icon={<Ruler className="w-3.5 h-3.5" />} label="Measure" active={mode === 'measure'} onClick={() => onModeChange('measure')} />
        <div className="border-t border-white/[0.18] my-1" />
        <ToolbarButton icon={<Camera className="w-3.5 h-3.5" />} label="Snapshot" onClick={onSnapshot} />
        <ToolbarButton icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset" onClick={onReset} />
        <ToolbarButton
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          label={autoRotate ? 'Auto ✓' : 'Auto'}
          active={autoRotate}
          onClick={onToggleAutoRotate}
        />
        {webXrAvailable && (
          <ToolbarButton
            icon={<Glasses className="w-3.5 h-3.5" />}
            label={webXrBusy ? 'VR…' : 'Enter VR'}
            onClick={onEnterVR}
          />
        )}
        <ToolbarButton icon={<Info className="w-3.5 h-3.5" />} label="Help" active={showHelp} onClick={onToggleHelp} />
      </div>

      {showHelp && (
        <div className="absolute top-14 right-3 z-20 w-64">
          <div className="bg-neutral-950/95 backdrop-blur-md border border-white/[0.18] rounded-xl p-4 text-xs text-white/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-sm">Viewer Controls</span>
              <button type="button" onClick={onToggleHelp} className="text-white/40 hover:text-white"><X className="w-3 h-3" /></button>
            </div>
            <HelpItem icon={<MousePointer className="w-3 h-3" />} title="Orbit">Left-drag rotate. Shift/right-drag pan. Scroll zoom.</HelpItem>
            <HelpItem icon={<Footprints className="w-3 h-3" />} title="Walk-Through">WASD move with collision proxy. Mouse look.</HelpItem>
            <HelpItem icon={<Ruler className="w-3 h-3" />} title="Measure">Calibrate with two known points, then measure on mesh surfaces.</HelpItem>
            <HelpItem icon={<Glasses className="w-3 h-3" />} title="WebXR">Enter VR when a headset is available.</HelpItem>
          </div>
        </div>
      )}
    </>
  );
}

function ToolbarButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  const color = active
    ? 'bg-white/15 text-white border-white/40'
    : 'bg-neutral-950/70 text-white/50 border-white/[0.22] hover:text-white hover:bg-white/[0.06]';
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all duration-150 border ${color} backdrop-blur-md`} title={label}>
      {icon}<span>{label}</span>
    </button>
  );
}

function HelpItem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-white/80 font-medium mb-0.5">{icon}{title}</div>
      <p className="text-white/40 leading-relaxed pl-5">{children}</p>
    </div>
  );
}

export function ViewerModeHint({ mode }: { mode: ViewerMode }) {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
      <div className="glass-panel text-white/50 text-[10px] px-3 py-1.5">
        {mode === 'orbit' && 'Left: Orbit  |  Shift+Drag / Right: Pan  |  Scroll: Zoom'}
        {mode === 'walkthrough' && 'WASD: Move  |  Mouse: Look  |  Space/Shift: Up/Down'}
        {mode === 'measure' && 'Click mesh surface · Esc/right-click undo'}
      </div>
    </div>
  );
}
