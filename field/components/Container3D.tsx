'use client';
import { Container3D as SharedContainer3D, type AssetRow } from '../../shared/components/Container3D';
export type { AssetRow };
export function Container3D(props: React.ComponentProps<typeof SharedContainer3D>) {
  return SharedContainer3D({ ...props, legendVariant: (props as any).legendVariant ?? 'stocked' } as any);
}
