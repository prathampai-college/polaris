import { CloudSnow, Flame, HeartPulse, Siren, Truck, Zap, type LucideIcon } from 'lucide-react';

// One vocabulary for the whole app — screens must never disagree on what a code means.

export const EMERGENCY_TYPES: { v: string; label: string; icon: LucideIcon }[] = [
  { v: 'SOS_MEDICAL', label: 'Medical', icon: HeartPulse },
  { v: 'SOS_FIRE', label: 'Fire', icon: Flame },
  { v: 'SOS_WHITEOUT', label: 'Whiteout / lost', icon: CloudSnow },
  { v: 'SOS_POWER', label: 'Power loss', icon: Zap },
  { v: 'SOS_VEHICLE', label: 'Vehicle', icon: Truck },
];

export function emergencyType(t: unknown): { label: string; icon: LucideIcon } {
  return EMERGENCY_TYPES.find((x) => x.v === t) ?? { label: String(t ?? '—').replace('SOS_', ''), icon: Siren };
}

export const CATEGORY_LABEL: Record<string, string> = {
  FUEL_DIESEL: 'Diesel', FUEL_KEROSENE: 'Kerosene', OXYGEN: 'Oxygen', FOOD: 'Food', MEDICAL: 'Medical',
  SPARES_DG: 'Generator spares', SPARES_HVAC: 'HVAC spares', SCIENTIFIC: 'Science',
};
export const categoryLabel = (c: unknown) => CATEGORY_LABEL[String(c)] ?? (c ? String(c) : '—');

export { MANIFEST_STAGES } from './db/stages';
