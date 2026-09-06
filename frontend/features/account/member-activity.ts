export type MemberActivityKind =
  | "draft"
  | "ingredient-request"
  | "published"
  | "saved"
  | "withdrawn";

export interface MemberActivity {
  detail?: string;
  href: string;
  id: string;
  kind: MemberActivityKind;
  label: string;
  timestamp: string;
  title: string;
}
