import { useTranslation } from 'react-i18next';
import { Link2, Box } from 'lucide-react';
import Section from './ui/Section';
import { ASSEMBLY_COLORS, type BalanceResult, type ComponentSettings } from '../utils/components';
import type { WingMount } from '../utils/assembly';

interface Props {
  balance: BalanceResult | null;
  settings: ComponentSettings;
  onChange: (s: ComponentSettings) => void;
  onShow3D: () => void;
}

const selectCls = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

function Row({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <i className="mt-1 inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
      <span>
        <b className="font-medium text-slate-700 dark:text-slate-200">{title}</b>
        <span className="block text-slate-500 dark:text-slate-400">{children}</span>
      </span>
    </li>
  );
}

/** How the wing is held and how the printed parts join, with the hardware to buy. */
export default function AssemblySection({ balance, settings, onChange, onShow3D }: Props) {
  const { t } = useTranslation();
  if (!balance) return null;
  const asm = balance.assembly;
  const j = asm.joiner;
  const mount = settings.wingMount ?? 'bands';

  return (
    <Section title={t('asm_title')} icon={<Link2 size={16} />}>
      {asm.mount !== 'none' && (
        <>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t('asm_wing_mount')}</label>
          {asm.bandsAvailable ? (
            <select className={selectCls} value={mount} onChange={e => onChange({ ...settings, wingMount: e.target.value as WingMount })}>
              <option value="bands">{t('asm_mount_bands')}</option>
              <option value="glued">{t('asm_mount_glued')}</option>
            </select>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-300">{t('asm_mount_glued')}</p>
          )}
          <p className="mt-1 mb-3 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {t(asm.mount === 'bands' ? 'asm_bands_hint' : asm.bandsAvailable ? 'asm_glued_hint' : 'asm_lowwing_hint')}
          </p>
        </>
      )}

      <ul className="space-y-2 text-[11px] leading-snug">
        <Row color={ASSEMBLY_COLORS.joiner} title={t('asm_joiner')}>
          {t(j.recessed ? 'asm_joiner_desc_recessed' : 'asm_joiner_desc_surface', { w: Math.round(2 * j.halfLen), c: Math.round(j.sb - j.sa), t: j.t })}
        </Row>
        {asm.bands && asm.sleeve && (
          <>
            <Row color={ASSEMBLY_COLORS.dowel} title={t('asm_dowels')}>
              {t('asm_dowels_desc', { d: asm.dowels[0].d, len: Math.round(asm.dowels[0].len), hole: asm.sleeve.od.toFixed(1) })}
            </Row>
            <Row color={ASSEMBLY_COLORS.band} title={t('asm_bands')}>
              {t('asm_bands_desc', { n: asm.bands.count, len: asm.bands.flatLen })}
            </Row>
          </>
        )}
        {balance.tailFit && (
          <Row color={ASSEMBLY_COLORS.tail} title={t('asm_tail')}>
            {balance.tailFit.finTab > 0
              ? t('asm_tail_desc', { mm: Math.round(balance.tailFit.finTab) })
              : t('asm_tail_desc_flat')}
          </Row>
        )}
        {balance.pins && (
          <Row color={ASSEMBLY_COLORS.pin} title={t('asm_pins')}>
            {t('asm_pins_desc', { n: balance.pins.joints.length * 2, d: balance.pins.d, len: balance.pins.length, j: balance.pins.joints.length })}
          </Row>
        )}
      </ul>

      <button
        type="button"
        onClick={onShow3D}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 hover:bg-sky-100 dark:hover:bg-sky-900/40"
      >
        <Box size={13} /> {t('asm_show_3d')}
      </button>
    </Section>
  );
}
