import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, currentLang, type LangCode } from './i18n';
import { track } from './utils/analytics';
import Sidebar from './components/Sidebar';
import InsightsDrawer, { type InsightsTab } from './components/InsightsDrawer';
import PowerSection from './components/PowerSection';
import AssemblySection from './components/AssemblySection';
import type { PowerCategory } from './utils/electricSystem';
import CanvasView from './components/CanvasView';
import Scene3D from './components/Scene3D';
import Header from './components/Header';
import KpiBar from './components/KpiBar';
import WelcomeModal from './components/WelcomeModal';
import ExamplesDialog from './components/ExamplesDialog';
import ConsentBanner from './components/ConsentBanner';
import PrivacyDialog from './components/PrivacyDialog';
import { getConsent, consentDate, setConsent, type Consent } from './utils/consent';
import type { ExampleProject } from './utils/examples';
import { projectFromUrl, shareUrl } from './utils/share';
import {
  calculateMetrics, validateDesign, AIRCRAFT_PRESETS, DEFAULT_CONTROL_SURFACES,
  LENGTH_KEYS, dimsInUnit, normalizeDims, sanitizeControls,
} from './utils/calculations';
import type { AircraftDimensions, AircraftType, AircraftPreset, FuselageType, NumericDimKey, PropellerType, ControlSurfaces, TailType, AirfoilSpec } from './utils/calculations';
import type { FuseStation } from './utils/fuseStations';
import { computeLayout } from './utils/geometry';
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from './utils/printParts';
import StlExportDialog from './components/StlExportDialog';
import StlArchiveDialog from './components/StlArchiveDialog';
import ModelLibraryDialog from './components/ModelLibraryDialog';
import StlViewer, { type ViewerFile } from './components/StlViewer';
import type { ArchivedProject } from './utils/stlArchive';
import {
  getActiveModelId, setActiveModelId, saveModel, makeModelThumbnail, listModels,
  type ModelRecord,
} from './utils/modelLibrary';
import { computeBalance, cutoutsFromBalance, DEFAULT_COMPONENTS, type ComponentSettings } from './utils/components';
import { exportToPDF } from './utils/pdfExport';
import { useVersionCheck } from './hooks/useVersionCheck';
import './App.css';

const defaultDimensions: AircraftDimensions = AIRCRAFT_PRESETS[0].defaults;

const STORAGE_KEY = 'aerobuilder_state_v2';
/** Stable empty payload so the viewer is not reset on every render. */
const NO_FILES: ViewerFile[] = [];
const LEGACY_DIMS_KEY = 'aerobuilder_dims';

interface PersistedState {
  dimensions: AircraftDimensions;
  unit: 'cm' | 'mm';
  aircraftType: AircraftType;
  airfoil: AirfoilSpec;
  fuselageStyle: FuselageType;
  tailType: TailType;
  propeller: PropellerType;
  controls: ControlSurfaces;
  isDarkMode: boolean;
  printSettings: PrintSettings;
  components: ComponentSettings;
  propCutout: boolean;
}

const DEFAULT_STATE: PersistedState = {
  dimensions: defaultDimensions,
  unit: 'cm',
  aircraftType: 'conventional',
  airfoil: 'clarky',
  fuselageStyle: 'trainer',
  tailType: 'conventional',
  propeller: 'prop_9x47',
  controls: DEFAULT_CONTROL_SURFACES.conventional,
  isDarkMode: false,
  printSettings: DEFAULT_PRINT_SETTINGS,
  components: DEFAULT_COMPONENTS,
  propCutout: true,
};

function loadState(): PersistedState {
  try {
    // A shared link (#p=...) takes precedence over what this browser saved
    const fromUrl = projectFromUrl<Partial<PersistedState>>();
    const raw = fromUrl ? null : localStorage.getItem(STORAGE_KEY);
    if (fromUrl || raw) {
      const p = (fromUrl ?? JSON.parse(raw!)) as Partial<PersistedState>;
      const type: AircraftType = p.aircraftType === 'flying_wing' ? 'flying_wing' : 'conventional';
      const unit = p.unit === 'mm' ? 'mm' : 'cm';
      const presetDims = dimsInUnit(AIRCRAFT_PRESETS.find(x => x.type === type)!.defaults, unit);
      return {
        ...DEFAULT_STATE,
        ...p,
        aircraftType: type,
        unit,
        dimensions: normalizeDims(p.dimensions, presetDims),
        controls: sanitizeControls({ ...DEFAULT_CONTROL_SURFACES[type], ...(p.controls ?? {}) }),
        printSettings: { ...DEFAULT_PRINT_SETTINGS, ...(p.printSettings ?? {}) },
        components: { ...DEFAULT_COMPONENTS, ...(p.components ?? {}) },
      };
    }
    // Older versions stored only the dimensions (always in cm, conventional)
    const legacy = localStorage.getItem(LEGACY_DIMS_KEY);
    if (legacy) {
      return { ...DEFAULT_STATE, dimensions: normalizeDims(JSON.parse(legacy), defaultDimensions) };
    }
  } catch (e) {
    console.error('Failed to load saved state', e);
  }
  return DEFAULT_STATE;
}

function App() {
  useVersionCheck();
  const { t, i18n } = useTranslation();

  const [initial] = useState(loadState);
  const [dimensions, setDimensions] = useState<AircraftDimensions>(initial.dimensions);
  const [unit, setUnit] = useState<'cm' | 'mm'>(initial.unit);
  const [aircraftType, setAircraftType] = useState<AircraftType>(initial.aircraftType);
  const [airfoil, setAirfoil] = useState<AirfoilSpec>(initial.airfoil);
  const [fuselageStyle, setFuselageStyle] = useState<FuselageType>(initial.fuselageStyle);
  const [tailType, setTailType] = useState<TailType>(initial.tailType ?? 'conventional');
  const [propeller, setPropeller] = useState<PropellerType>(initial.propeller);
  const [controls, setControls] = useState<ControlSurfaces>(initial.controls);
  const [insights, setInsights] = useState<InsightsTab | null>(null);
  const closeInsights = useCallback(() => setInsights(null), []);
  const [powerCategory, setPowerCategory] = useState<PowerCategory>('trainer');
  const [explode, setExplode] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(initial.isDarkMode);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');
  const [printSettings, setPrintSettings] = useState<PrintSettings>(initial.printSettings);
  const [stlOpen, setStlOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [currentModelId, setCurrentModelId] = useState<string | null>(() => getActiveModelId());
  const [currentModelName, setCurrentModelName] = useState<string>(() => t('model_default_name'));
  const [dirty, setDirty] = useState(false);
  /** JSON of the last saved snapshot — the dirty flag is a string comparison against it */
  const savedJsonRef = useRef<string>('');
  /** A shared link (#p=…) must never overwrite a saved model */
  const [openedFromShare] = useState(() => {
    try { return window.location.hash.includes('p='); } catch { return false; }
  });
  const [viewer, setViewer] = useState<{ files: ViewerFile[]; subtitle?: string; seq: number } | null>(null);
  /** Opening the viewer always remounts it (key) so nothing leaks between sets. */
  const openViewer = useCallback((files: ViewerFile[], subtitle?: string) => {
    setViewer({ files, subtitle, seq: Date.now() });
  }, []);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [consent, setConsentState] = useState<Consent>(() => getConsent());
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const chooseConsent = (v: 'granted' | 'denied') => {
    setConsent(v);
    setConsentState(v);
    if (v === 'granted') setPrivacyOpen(false);
  };
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    try { return !localStorage.getItem('aerobuilder_welcome_seen') && !projectFromUrl(); } catch { return false; }
  });
  const closeWelcome = () => {
    setWelcomeOpen(false);
    try { localStorage.setItem('aerobuilder_welcome_seen', '1'); } catch { /* ignore */ }
  };

  /** Marks the current design as "saved" (after a model save/load). */
  const markSaved = useCallback((snapshot: ArchivedProject) => {
    savedJsonRef.current = JSON.stringify(snapshot);
    setDirty(false);
  }, []);

  // A shared link was loaded: drop the hash so later edits don't look like the shared version
  useEffect(() => {
    if (window.location.hash.includes('p=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);
  const [components, setComponents] = useState<ComponentSettings>(initial.components);
  const [propCutout, setPropCutout] = useState<boolean>(initial.propCutout !== false);

  // Persist the whole project (dimensions are meaningless without their unit/type)
  useEffect(() => {
    try {
      const state: PersistedState = { dimensions, unit, aircraftType, airfoil, fuselageStyle, tailType, propeller, controls, isDarkMode, printSettings, components, propCutout };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(LEGACY_DIMS_KEY);
    } catch { /* storage unavailable (private mode) — ignore */ }
  }, [dimensions, unit, aircraftType, airfoil, fuselageStyle, tailType, propeller, controls, isDarkMode, printSettings, components, propCutout]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const metrics = useMemo(() => calculateMetrics(dimensions, aircraftType, controls, tailType), [dimensions, aircraftType, controls, tailType]);
  const validationChecks = useMemo(() => validateDesign(dimensions, metrics, aircraftType), [dimensions, metrics, aircraftType]);
  const layout = useMemo(
    () => computeLayout(dimensions, aircraftType, controls, metrics, unit, fuselageStyle, propeller, propCutout, tailType),
    [dimensions, aircraftType, controls, metrics, unit, fuselageStyle, propeller, propCutout, tailType],
  );
  const balance = useMemo(() => {
    try {
      return computeBalance(layout, airfoil, components);
    } catch (e) {
      console.error('Balance computation failed', e);
      return null;
    }
  }, [layout, airfoil, components]);
  const pockets = useMemo(() => (balance ? cutoutsFromBalance(balance, layout) : []), [balance, layout]);

  /** Project snapshot stored with every archived STL set. */
  const projectSnapshot: ArchivedProject = useMemo(() => ({
    dimensions, unit, aircraftType, airfoil, fuselageStyle, tailType, propeller, controls,
    printSettings, components, propCutout,
  }), [dimensions, unit, aircraftType, airfoil, fuselageStyle, tailType, propeller, controls, printSettings, components, propCutout]);

  // Dirty flag: debounced comparison so typing in the sidebar does not thrash state
  useEffect(() => {
    const id = setTimeout(() => {
      // Right after a load the live state is the baseline, whatever the saved JSON said
      if (justLoadedRef.current) {
        justLoadedRef.current = false;
        savedJsonRef.current = JSON.stringify(projectSnapshot);
        setDirty(false);
        return;
      }
      if (!savedJsonRef.current) return;
      setDirty(JSON.stringify(projectSnapshot) !== savedJsonRef.current);
    }, 300);
    return () => clearTimeout(id);
  }, [projectSnapshot]);

  // Leaving with unsaved work warns once (browser only; the APK has no unload)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Restores a whole design from the STL archive or the model library (same path as loading an example). */
  const applySnapshot = (p: ArchivedProject) => {
    const type: AircraftType = p.aircraftType === 'flying_wing' ? 'flying_wing' : 'conventional';
    const u: 'cm' | 'mm' = p.unit === 'mm' ? 'mm' : 'cm';
    const presetDims = dimsInUnit(AIRCRAFT_PRESETS.find(x => x.type === type)!.defaults, u);
    setAircraftType(type);
    setUnit(u);
    setDimensions(normalizeDims(p.dimensions, presetDims));
    setAirfoil(p.airfoil);
    setFuselageStyle(p.fuselageStyle);
    setTailType(p.tailType ?? 'conventional');
    setPropeller(p.propeller);
    setControls(sanitizeControls(p.controls));
    setComponents({ ...DEFAULT_COMPONENTS, ...p.components });
    setPrintSettings({ ...DEFAULT_PRINT_SETTINGS, ...p.printSettings });
    setPropCutout(p.propCutout !== false);
  };

  /** Set when a model/example was just loaded: the next render re-baselines the dirty check. */
  const justLoadedRef = useRef(false);

  const saveCurrentModel = useCallback(async (name: string, asNew: boolean): Promise<ModelRecord | null> => {
    const thumb = await makeModelThumbnail(layout, airfoil);
    const rec = await saveModel({ id: asNew ? null : currentModelId, name, snapshot: projectSnapshot, thumb });
    setCurrentModelId(rec.id);
    setCurrentModelName(rec.name);
    setActiveModelId(rec.id);
    markSaved(projectSnapshot);
    return rec;
  }, [layout, airfoil, currentModelId, projectSnapshot, markSaved]);

  const loadModelRecord = (rec: ModelRecord) => {
    applySnapshot(rec.snapshot);
    setCurrentModelId(rec.id);
    setCurrentModelName(rec.name);
    setActiveModelId(rec.id);
    justLoadedRef.current = true;
    setDirty(false);
  };

  // First run: keep the existing single design as "Model 1"; a shared link never becomes a model
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (openedFromShare) {
          setCurrentModelId(null);
          setCurrentModelName(t('model_shared'));
          justLoadedRef.current = true;
          return;
        }
        const models = await listModels();
        if (cancelled) return;
        if (models.length === 0) {
          const rec = await saveModel({
            name: t('model_default_name'),
            snapshot: projectSnapshot,
            thumb: await makeModelThumbnail(layout, airfoil),
          });
          if (cancelled) return;
          setCurrentModelId(rec.id);
          setCurrentModelName(rec.name);
          setActiveModelId(rec.id);
          justLoadedRef.current = true;
        } else if (currentModelId) {
          const rec = models.find(m => m.id === currentModelId);
          if (rec) setCurrentModelName(rec.name);
          else { setCurrentModelId(null); setActiveModelId(null); }
        }
      } catch (e) {
        console.warn('Model library init skipped', e);
      }
    })();
    return () => { cancelled = true; };
    // Runs once on mount on purpose (current state is the design to migrate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnitToggle = (newUnit: 'cm' | 'mm') => {
    if (unit === newUnit) return;

    const multiplier = newUnit === 'mm' ? 10 : 0.1;

    setDimensions(prev => {
      const newDims = { ...prev };
      // Convert lengths only (dihedral is in degrees)
      LENGTH_KEYS.forEach(key => {
        newDims[key] = parseFloat((newDims[key] * multiplier).toFixed(2));
      });
      return newDims;
    });

    setUnit(newUnit);
  };

  const handleDimensionChange = (key: NumericDimKey, value: number) => {
    setDimensions(prev => ({ ...prev, [key]: value }));
  };

  /** Manual fuselage shape edits from the 3D station editor. */
  const handleStationsChange = (list: FuseStation[]) => {
    setDimensions(prev => ({ ...prev, fuseStations: list }));
  };

  const handleControlChange = (key: keyof ControlSurfaces, value: number) => {
    setControls(prev => ({ ...prev, [key]: value }));
  };


  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      // The PDF's built-in fonts have no CJK glyphs: Chinese exports in English
      const pdfLang = currentLang() === 'zh' || currentLang() === 'hi' ? 'en' : currentLang();
      const pdfT = pdfLang === currentLang() ? t : i18n.getFixedT('en');
      await exportToPDF(dimensions, metrics, validationChecks, unit, pdfLang, (k, o) => pdfT(k, o) as string, layout, controls, aircraftType, airfoil, balance);
      track('export_pdf', { aircraft_type: aircraftType });
    } catch (error) {
      console.error("PDF Export failed", error);
    }
    setIsExporting(false);
  };

  const handleReset = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setDimensions(defaultDimensions);
    setUnit('cm');
    setAircraftType('conventional');
    setAirfoil('clarky');
    setFuselageStyle('trainer');
    setTailType('conventional');
    setPropeller('prop_9x47');
    setControls(DEFAULT_CONTROL_SURFACES.conventional);
    setComponents(DEFAULT_COMPONENTS);
  };

  const handleShare = async (): Promise<boolean> => {
    track('share_link', { aircraft_type: aircraftType });
    const url = shareUrl({ dimensions, unit, aircraftType, airfoil, fuselageStyle, tailType, propeller, controls, printSettings, components, propCutout });
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      window.prompt(t('share_hint'), url);
      return false;
    }
  };

  const loadExample = (ex: ExampleProject) => {
    track('load_example', { example_id: ex.id });
    const st = ex.state;
    setDimensions(dimsInUnit(st.dimensions, unit));
    setAircraftType(st.aircraftType);
    setAirfoil(st.airfoil);
    setFuselageStyle(st.fuselageStyle);
    setTailType(st.tailType ?? 'conventional');
    setPropeller(st.propeller);
    setControls(sanitizeControls(st.controls));
    setComponents(st.components);
    setPropCutout(st.propCutout);
    setExamplesOpen(false);
  };

  const handlePresetSelect = (preset: AircraftPreset) => {
    setAircraftType(preset.type);
    // Presets are authored in cm — convert to the unit currently in use
    setDimensions(dimsInUnit(preset.defaults, unit));
    setControls(DEFAULT_CONTROL_SURFACES[preset.type]);
    // Auto-select sensible defaults for each aircraft type
    if (preset.type === 'flying_wing') {
      setPropeller('prop_8x45P');
      setAirfoil('mh45');
    } else {
      setPropeller('prop_9x47');
      setAirfoil('clarky');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 overflow-hidden font-sans text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <Header
        aircraftType={aircraftType}
        onPreset={handlePresetSelect}
        viewMode={viewMode}
        onViewMode={setViewMode}
        unit={unit}
        onUnit={handleUnitToggle}
        isDarkMode={isDarkMode}
        onToggleDark={() => setIsDarkMode(!isDarkMode)}
        onLanguage={(code: LangCode) => { track('change_language', { to: code }); setLanguage(code); }}
        onReset={handleReset}
        onExportPDF={handleExportPDF}
        isExporting={isExporting}
        onOpenSTL={() => setStlOpen(true)}
        onOpenArchive={() => setArchiveOpen(true)}
        onOpenViewer={() => openViewer(NO_FILES)}
        onOpenModels={() => setModelsOpen(true)}
        modelName={currentModelName}
        dirty={dirty}
        onShare={handleShare}
        onHelp={() => setWelcomeOpen(true)}
        onExamples={() => setExamplesOpen(true)}
      />
      <KpiBar metrics={metrics} checks={validationChecks} balance={balance} layout={layout} unit={unit} onOpen={setInsights} />

      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden relative">
        <div className="order-2 lg:order-1 w-full lg:w-80 flex-shrink-0 z-10">
          <Sidebar
            dimensions={dimensions}
            onChange={handleDimensionChange}
            controls={controls}
            onControlChange={handleControlChange}
            metrics={metrics}
            unit={unit}
            aircraftType={aircraftType}
            airfoil={airfoil}
            onAirfoilChange={setAirfoil}
            fuselageStyle={fuselageStyle}
            onFuselageStyleChange={setFuselageStyle}
            tailType={tailType}
            onTailTypeChange={setTailType}
            propeller={propeller}
            onPropellerChange={setPropeller}
            propCutout={propCutout}
            onPropCutoutChange={setPropCutout}
            teCutNeedsElevonStart={layout.teCutNeedsElevonStart}
            powerSection={
              <PowerSection
                balance={balance}
                settings={components}
                onChange={setComponents}
                layout={layout}
                dimensions={dimensions}
                aircraftType={aircraftType}
                unit={unit}
                powerCategory={powerCategory}
                onPowerCategory={setPowerCategory}
                onOpenDetails={() => setInsights('weight')}
              />
            }
            assemblySection={
              <AssemblySection
                balance={balance}
                settings={components}
                onChange={setComponents}
                onShow3D={() => { setViewMode('3D'); setExplode(1); }}
              />
            }
          />
        </div>

        <div className="order-1 lg:order-2 w-full lg:flex-1 relative min-h-[420px] border-b lg:border-b-0 border-slate-200 dark:border-slate-800 overflow-x-auto bg-white dark:bg-slate-900">
          {/* The model makes room for the details panel instead of hiding under it */}
          <div className={`absolute inset-0 ${insights ? 'lg:right-[392px]' : ''}`}>
            {viewMode === '2D' ? (
              <CanvasView layout={layout} isDarkMode={isDarkMode} airfoil={airfoil} balance={balance} />
            ) : (
              <Scene3D
                layout={layout}
                airfoil={airfoil}
                isDarkMode={isDarkMode}
                printSettings={printSettings}
                balance={balance}
                pockets={pockets}
                explode={explode}
                onExplode={setExplode}
                stations={dimensions.fuseStations ?? []}
                onStationsChange={handleStationsChange}
                unit={unit}
              />
            )}
          </div>
          <InsightsDrawer
            tab={insights}
            onTab={setInsights}
            onClose={closeInsights}
            metrics={metrics}
            checks={validationChecks}
            unit={unit}
            isDarkMode={isDarkMode}
            aircraftType={aircraftType}
            dimensions={dimensions}
            balance={balance}
            components={components}
            onComponentsChange={setComponents}
            layout={layout}
            powerCategory={powerCategory}
          />
        </div>
      </main>
      <StlExportDialog
        open={stlOpen}
        onClose={() => setStlOpen(false)}
        layout={layout}
        airfoil={airfoil}
        tailType={tailType}
        settings={printSettings}
        onSettingsChange={setPrintSettings}
        pockets={pockets}
        balance={balance}
        project={projectSnapshot}
        modelId={currentModelId}
        modelName={currentModelName}
      />
      <StlArchiveDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onLoadProject={(p) => {
          applySnapshot(p);
          setCurrentModelId(null);
          setCurrentModelName(t('model_default_name'));
          justLoadedRef.current = true;
          setDirty(false);
        }}
        onView={openViewer}
      />
      <ModelLibraryDialog
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        currentId={currentModelId}
        currentName={currentModelName}
        dirty={dirty}
        onLoad={loadModelRecord}
        onSaveCurrent={saveCurrentModel}
        onDeleted={() => { setCurrentModelId(null); setCurrentModelName(t('model_default_name')); }}
      />
      <StlViewer
        key={viewer?.seq ?? 0}
        open={viewer !== null}
        onClose={() => setViewer(null)}
        files={viewer?.files ?? NO_FILES}
        subtitle={viewer?.subtitle}
      />
      <WelcomeModal open={welcomeOpen} onClose={closeWelcome} onExamples={() => { closeWelcome(); setExamplesOpen(true); }} />
      <ExamplesDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} onLoad={loadExample} />
      <PrivacyDialog
        open={privacyOpen}
        consent={consent}
        consentAt={consent ? consentDate() : null}
        onClose={() => setPrivacyOpen(false)}
        onAccept={() => chooseConsent('granted')}
        onReject={() => chooseConsent('denied')}
      />
      {consent === null && !privacyOpen && (
        <ConsentBanner onAccept={() => chooseConsent('granted')} onReject={() => chooseConsent('denied')} onMore={() => setPrivacyOpen(true)} />
      )}
      <footer className="flex-shrink-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 z-20">
        <span>{t('developed_by')} <a href="https://www.linkedin.com/in/alvaromarcus/" target="_blank" rel="noopener noreferrer" className="text-sky-700 dark:text-sky-400 hover:underline">Alvaro Marcus</a></span>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/Alvaromarcus/Airplane_model" target="_blank" rel="noopener noreferrer" className="hover:underline">GitHub</a>
        <span aria-hidden="true">·</span>
        <span>{t('footer_disclaimer')}</span>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => setPrivacyOpen(true)} className="hover:underline">{t('privacy_footer_link')}</button>
      </footer>
    </div>
  );
}

export default App;
