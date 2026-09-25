import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ManufacturingCreateDraft = {
  open: boolean;
  customerId: string;
  customerLabel: string;
  finishedVariantId: string;
  quantity: string;
  title: string;
  promisedAt: string;
  suggestedLeadDays: number | null;
  promisedAtTouched: boolean;
  technicalId: string;
};

function emptyDraft(): ManufacturingCreateDraft {
  return {
    open: false,
    customerId: '',
    customerLabel: '',
    finishedVariantId: '',
    quantity: '1',
    title: '',
    promisedAt: '',
    suggestedLeadDays: null,
    promisedAtTouched: false,
    technicalId: '',
  };
}

type Ctx = {
  draft: ManufacturingCreateDraft;
  patchDraft: (partial: Partial<ManufacturingCreateDraft>) => void;
  resetDraft: () => void;
  openNewProject: () => void;
  closeModal: () => void;
};

const ManufacturingCreateDraftContext = createContext<Ctx | null>(null);

export function ManufacturingCreateDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ManufacturingCreateDraft>(emptyDraft);

  const patchDraft = useCallback((partial: Partial<ManufacturingCreateDraft>) => {
    setDraft((d) => ({ ...d, ...partial }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(emptyDraft());
  }, []);

  const openNewProject = useCallback(() => {
    setDraft({ ...emptyDraft(), open: true });
  }, []);

  const closeModal = useCallback(() => {
    setDraft((d) => ({ ...d, open: false }));
  }, []);

  const value = useMemo(
    () => ({ draft, patchDraft, resetDraft, openNewProject, closeModal }),
    [draft, patchDraft, resetDraft, openNewProject, closeModal],
  );

  return (
    <ManufacturingCreateDraftContext.Provider value={value}>
      {children}
    </ManufacturingCreateDraftContext.Provider>
  );
}

export function useManufacturingCreateDraft(): Ctx {
  const ctx = useContext(ManufacturingCreateDraftContext);
  if (!ctx) {
    throw new Error('useManufacturingCreateDraft must be used within ManufacturingCreateDraftProvider');
  }
  return ctx;
}
