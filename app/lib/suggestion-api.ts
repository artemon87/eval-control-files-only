import type {
  Suggestion,
  SuggestionStatus,
} from "./suggestion-types";

const API_BASE = "/api/eval/suggestions";

type SuggestionsResponse = {
  items: Suggestion[];
};

type SuggestionAuthorization = {
  permissions?: string[];
};

export async function getSuggestions(
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const response = await fetch(`${API_BASE}?limit=100`, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Suggestions API ${response.status}`);
  }

  const payload =
    (await response.json()) as SuggestionsResponse;

  return payload.items ?? [];
}


export async function getSuggestionManagePermission(): Promise<boolean> {
  const response = await fetch("/api/eval/auth/me", {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return false;
  }

  const authorization =
    (await response.json()) as SuggestionAuthorization;

  return authorization.permissions?.includes(
    "suggestions.manage",
  ) ?? false;
}


export async function createSuggestion(
  title: string,
  description: string,
  images: File[],
): Promise<void> {
  const formData = new FormData();

  formData.set("title", title);
  formData.set("description", description);

  images.forEach((file) => {
    formData.append("images", file, file.name);
  });

  const response = await fetch(API_BASE, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;

    throw new Error(
      payload?.detail ?? `Suggestions API ${response.status}`,
    );
  }
}


export async function setSuggestionVote(
  suggestionId: string,
  hasVoted: boolean,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(suggestionId)}/vote`,
    {
      method: hasVoted ? "DELETE" : "PUT",
    },
  );

  if (!response.ok) {
    throw new Error(`Vote failed (${response.status})`);
  }
}


export async function patchSuggestionStatus(
  suggestionId: string,
  nextStatus: SuggestionStatus,
): Promise<Suggestion> {
  const response = await fetch(
    `${API_BASE}/${encodeURIComponent(suggestionId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: nextStatus,
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
      message ||
        `Status update failed (${response.status})`,
    );
  }

  return (await response.json()) as Suggestion;
}