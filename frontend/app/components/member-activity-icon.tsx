import { DiamondMinus, EyeOff, Heart, Pencil, Upload } from "lucide-react";

import type { MemberActivityKind } from "../../lib/member-activity";

interface MemberActivityIconProps {
  kind: MemberActivityKind;
}

export function MemberActivityIcon({ kind }: MemberActivityIconProps) {
  const Icon = {
    draft: Pencil,
    "ingredient-request": DiamondMinus,
    published: Upload,
    saved: Heart,
    withdrawn: EyeOff,
  } satisfies Record<MemberActivityKind, typeof Pencil>;

  const ActivityIcon = Icon[kind];
  return <ActivityIcon aria-hidden="true" />;
}
