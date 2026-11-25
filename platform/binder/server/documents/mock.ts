import type { FastifyInstance } from 'fastify';
import type {
  LegacyDocumentData,
  LegacyDocumentListInput,
  SyntheticDocImage,
} from './legacy-contract.ts';
export { DOCUMENT_FIXTURE_DATE } from './policy.ts';

function document(
  id: string,
  name: string,
  overrides: Partial<LegacyDocumentData> = {},
): LegacyDocumentData {
  return {
    createDate: '2026-11-12',
    divisionNbr: '71',
    docType: 1,
    documentId: id,
    documentName: name,
    effectiveDate: '2026-11-13',
    endDate: '2026-11-30',
    fobArray: ['Apparel'],
    metaDataArray: [
      {
        docId: id,
        fieldName: 'Description',
        value:
          'A synthetic training alert for local demonstration. No operational policy is represented.',
      },
    ],
    pageCount: 2,
    storeArray: ['1001'],
    ...overrides,
  };
}

export const legacyDocuments: readonly LegacyDocumentData[] = [
  document('101', 'Holiday floor readiness', {
    metaDataArray: [
      {
        docId: '101',
        fieldName: 'Description',
        value:
          'Prepare the floor, answer common questions, and help each customer find their next favorite. Synthetic training content only.',
      },
    ],
  }),
  document('102', 'A thoughtful handoff', {
    effectiveDate: '2026-11-01',
    endDate: null,
    fobArray: ['Home'],
    pageCount: 1,
    storeArray: ['9999'],
    metaDataArray: [
      {
        docId: '102',
        fieldName: 'Description',
        value:
          'Simple conversation cues for a clear, welcoming handoff between departments. This is synthetic demonstration material.',
      },
    ],
  }),
  document('103', 'Expired training fixture', { endDate: '2026-11-13' }),
  document('104', 'Future training fixture', { effectiveDate: '2026-11-15' }),
  document('105', 'Another store fixture', { storeArray: ['1002'] }),
  document('106', 'Another division fixture', { divisionNbr: '72' }),
  document('107', 'Private store scope fixture', { storeArray: [] }),
  document('108', 'Another document type fixture', { docType: 2 }),
];

const pageContent: Record<string, Array<{ title: string; paragraphs: string[] }>> = {
  '101': [
    {
      title: 'A ready floor. A warmer welcome.',
      paragraphs: [
        'Start with the customer journey. Walk the department as a customer would: look for clear paths, easy-to-find sizes, and a welcoming place to ask for help.',
        'Bring the details together. Check that display stories are complete, presentation is consistent, and your team knows who can help with a question.',
        'Make the first moment count. Offer a simple greeting, listen to what brought the customer in, and suggest one useful next step.',
        'Team conversation: What is one small change that would make our department easier to shop today?',
      ],
    },
    {
      title: 'Keep the conversation moving.',
      paragraphs: [
        'Ask one useful question. A thoughtful question helps you understand the occasion, the person, and what matters most to them.',
        "Make a clear connection. When another department can help, explain why, introduce the next associate when possible, and share the customer's goal.",
        'Close with confidence. Confirm the next step and invite any final question. A clear handoff makes the experience feel connected.',
        'Practice together: Pair up and rehearse a short greeting and handoff using an entirely fictional customer scenario.',
      ],
    },
  ],
  '102': [
    {
      title: 'One team. A connected experience.',
      paragraphs: [
        "Begin with context. Introduce the customer's goal and the assistance already offered so they do not need to start the conversation again.",
        'Name the next step. Explain where you are heading and how the next associate can help. Keep the language clear and welcoming.',
        'Acknowledge the handoff. Check that the customer knows who is helping them next, then thank them for the conversation.',
        'This page is invented for the Overlock demonstration. It is not an official training document or store procedure.',
      ],
    },
  ],
};

export function registerMockDocumentRoutes(app: FastifyInstance) {
  app.post<{ Body: LegacyDocumentListInput }>('/legacy/documents/list', async () => ({
    ok: true,
    service: 'mock-upstream',
    synthetic: true,
    // A broad catalog intentionally exercises Bobbin's independent eligibility rules.
    documentData: legacyDocuments,
  }));
  app.get<{ Params: { id: string } }>('/legacy/documents/:id', async (request) => ({
    ok: true,
    service: 'mock-upstream',
    synthetic: true,
    documentData: legacyDocuments.find((item) => item.documentId === request.params.id) ?? null,
  }));
  app.get<{ Params: { id: string; page: string } }>(
    '/legacy/documents/:id/pages/:page',
    async (request) => {
      const metadata = legacyDocuments.find((item) => item.documentId === request.params.id);
      const number = Number(request.params.page);
      const content = pageContent[request.params.id]?.[number - 1];
      const docImage: SyntheticDocImage | null =
        metadata && content
          ? {
              format: 'synthetic-page-v1',
              documentId: metadata.documentId,
              pageNumber: number,
              pageCount: metadata.pageCount,
              ...content,
            }
          : null;
      return { ok: true, service: 'mock-upstream', synthetic: true, docImage };
    },
  );
}
