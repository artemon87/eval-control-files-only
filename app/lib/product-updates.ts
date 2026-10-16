export type ProductUpdateStatus = "shipped" | "coming" | "planned";

export type ProductUpdate = {
  id: string;
  status: ProductUpdateStatus;
  date: string;
  displayDate: string;
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
  visual?: "access" | "suggestions" | "roadmap";
  image?: {
    id: string;
    filename: string;
    content_type: "image/png" | "image/jpeg";
    size_bytes: number;
  } | null;
};

export const productUpdates: ProductUpdate[] = [
  {
    id: "secure-access",
    status: "shipped",
    date: "2026-10-15",
    displayDate: "October 15, 2026",
    eyebrow: "Identity & access",
    title: "Secure sign-in and role-based access",
    description:
      "EvalHub now has a guided access experience, with authenticated identity and permissions that keep sensitive actions in the right hands.",
    highlights: [
      "Microsoft Entra sign-in",
      "Request Editor or Admin access",
      "Admin review and role management",
    ],
    visual: "access",
  },
  {
    id: "suggestions-workspace",
    status: "shipped",
    date: "2026-10-12",
    displayDate: "October 12, 2026",
    eyebrow: "Product feedback",
    title: "A shared workspace for suggestions",
    description:
      "Users can propose improvements, vote on ideas, and follow each suggestion as it moves from review toward delivery.",
    highlights: [
      "Submit and vote on ideas",
      "Filter by status",
      "Visible review progress",
    ],
    visual: "suggestions",
  },
  {
    id: "suggestion-images",
    status: "coming",
    date: "2026-10-20",
    displayDate: "Coming next",
    eyebrow: "Suggestions",
    title: "Add screenshots to a suggestion",
    description:
      "Attach screenshots when words are not enough, so reviewers can understand UI issues and proposed improvements faster.",
    highlights: [
      "PNG, JPEG, and HEIC support",
      "Preview before submitting",
      "Open images in a focused viewer",
    ],
    visual: "suggestions",
  },
  {
    id: "configuration-tools",
    status: "planned",
    date: "2026-11-01",
    displayDate: "On the roadmap",
    eyebrow: "Configuration",
    title: "Manage policies and custom metrics",
    description:
      "Bring evaluation rules closer to the people operating EvalHub, with clearer ownership and fewer code-only configuration steps.",
    highlights: [
      "Policy visibility",
      "Custom metric management",
      "Permission-aware editing",
    ],
    visual: "roadmap",
  },
];
