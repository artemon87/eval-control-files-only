import type { ProductUpdate, ProductUpdateStatus } from "./product-updates";

const API_BASE = "/api/eval/product-updates";

type ApiProductUpdate = {
  id: string;
  status: ProductUpdateStatus;
  release_date: string;
  category: string;
  title: string;
  description: string;
  highlights: string[];
  image?: ProductUpdate["image"];
};

function toProductUpdate(item: ApiProductUpdate): ProductUpdate {
  return {
    id: item.id,
    status: item.status,
    date: item.release_date,
    displayDate: new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${item.release_date}T00:00:00Z`)),
    eyebrow: item.category,
    title: item.title,
    description: item.description,
    highlights: item.highlights,
    image: item.image,
  };
}

export async function getProductUpdates(signal?: AbortSignal): Promise<ProductUpdate[]> {
  const response = await fetch(`${API_BASE}?limit=100`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Product updates API ${response.status}`);
  const payload = (await response.json()) as { items?: ApiProductUpdate[] };
  return (payload.items ?? []).map(toProductUpdate);
}

export type ProductUpdateInput = {
  status: ProductUpdateStatus;
  releaseDate: string;
  category: string;
  title: string;
  description: string;
  highlights: string[];
  image?: File | null;
};

function formDataFor(input: ProductUpdateInput, includeImage: boolean): FormData {
  const body = new FormData();
  body.set("status", input.status);
  body.set("release_date", input.releaseDate);
  body.set("category", input.category);
  body.set("title", input.title);
  body.set("description", input.description);
  body.set("highlights", JSON.stringify(input.highlights));
  if (includeImage && input.image) body.set("image", input.image, input.image.name);
  return body;
}

async function checked(response: Response): Promise<void> {
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
  throw new Error(payload?.detail ?? `Product updates API ${response.status}`);
}

export async function createProductUpdate(input: ProductUpdateInput): Promise<void> {
  await checked(await fetch(API_BASE, { method: "POST", body: formDataFor(input, true) }));
}

export async function updateProductUpdate(id: string, input: ProductUpdateInput): Promise<void> {
  await checked(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: formDataFor(input, false),
  }));
}

export async function deleteProductUpdate(id: string): Promise<void> {
  await checked(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export function productUpdateImageUrl(id: string): string {
  return `${API_BASE}/${encodeURIComponent(id)}/image`;
}
