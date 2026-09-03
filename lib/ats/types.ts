export type NormalizedJob = {
  external_id: string;
  title: string;
  url: string;
  location: string | null;
  remote_ok: boolean | null;
  comp_min: number | null;
  comp_max: number | null;
  raw: unknown;
  description_text: string | null;
};

export type FetchResult = {
  companyId: number;
  companyName: string;
  jobs: NormalizedJob[];
};

export type FetchError = {
  company: string;
  error: string;
};
