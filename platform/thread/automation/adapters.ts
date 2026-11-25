import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type {
  ThreadArtifactInspectorAdapter,
  ThreadAutomationAdapters,
  ThreadAutomationFixtureId,
  ThreadBuilderResult,
  ThreadComponentBuilderAdapter,
  ThreadDesignSourceAdapter,
  ThreadDesignSourceResult,
} from './contracts.ts';

const fixtures: Record<ThreadAutomationFixtureId, ThreadDesignSourceResult> = {
  'inventory-button': {
    requirement: {
      requestId: 'thread.request.automation-button',
      objectId: 'thread.component.button',
      name: 'Button',
      description: 'Shared button primitive with primary, secondary and ghost variants.',
      category: 'primitive',
      owner: { team: 'Thread Platform', issueLabel: 'thread:automation-button' },
      source: {
        kind: 'figma',
        fileKey: 'mockRetailDesign',
        componentKey: 'sharedButton',
        nodeId: '12:44',
      },
    },
    artifactId: 'thread.artifact.automation-button',
  },
  'figma-promotion-banner': {
    requirement: {
      requestId: 'thread.request.promotion-banner-auto',
      objectId: 'thread.component.promotion-banner-auto',
      name: 'PromotionBannerAuto',
      description: 'Presents a governed store promotion with bounded marketing content.',
      category: 'domain',
      owner: { team: 'Thread Platform', issueLabel: 'thread:promotion-banner-auto' },
      source: {
        kind: 'figma',
        fileKey: 'mockRetailDesign',
        componentKey: 'promotionBannerAuto',
        nodeId: '88:102',
      },
    },
    artifactId: 'thread.artifact.promotion-banner-auto',
  },
};

export class MockFigmaDesignSourceAdapter implements ThreadDesignSourceAdapter {
  readonly id = 'mock-figma@1.0.0';

  async resolve(fixtureId: ThreadAutomationFixtureId): Promise<ThreadDesignSourceResult> {
    const fixture = fixtures[fixtureId];
    if (!fixture) throw new Error('The requested mock Figma fixture is not allow-listed.');
    return structuredClone(fixture);
  }
}

export class ControlledTemplateBuilderAdapter implements ThreadComponentBuilderAdapter {
  readonly id = 'controlled-template@1.0.0';

  async build(source: ThreadDesignSourceResult): Promise<ThreadBuilderResult> {
    if (source.requirement.name !== 'PromotionBannerAuto')
      throw new Error('No reviewed component template exists for this fixture.');
    const sourceText = [
      "import React from 'react';",
      '',
      'export interface PromotionBannerAutoProps {',
      '  eyebrow: string;',
      '  title: string;',
      '}',
      '',
      'export function PromotionBannerAuto({ eyebrow, title }: PromotionBannerAutoProps) {',
      "  return <section aria-label={title}><span>{eyebrow}</span><strong>{title}</strong></section>;",
      '}',
      '',
    ].join('\n');
    return {
      submission: {
        candidate: {
          version: '0.1.0',
          code: {
            framework: 'react',
            packageName: '@macys/thread-react',
            exportName: 'PromotionBannerAuto',
            sourcePath: 'platform/thread/candidates/promotion-banner-auto.tsx',
          },
          figma: {
            status: 'mapped',
            fileKey: 'mockRetailDesign',
            componentKey: 'promotionBannerAuto',
            nodeId: '88:102',
          },
        },
        tests: {
          result: 'passed',
          artifactId: 'report:tests:promotion-banner-auto',
        },
      },
      sourceText,
    };
  }
}

export class ServerSha256ArtifactInspectorAdapter implements ThreadArtifactInspectorAdapter {
  readonly id = 'server-sha256@1.0.0';

  async inspect(
    source: ThreadDesignSourceResult,
    build: ThreadBuilderResult,
  ): Promise<Awaited<ReturnType<ThreadArtifactInspectorAdapter['inspect']>>> {
    if (
      typeof build.sourceText !== 'string' ||
      !build.sourceText ||
      Buffer.byteLength(build.sourceText, 'utf8') > 64 * 1024 ||
      /[\u0000\u007f]/.test(build.sourceText)
    )
      throw new Error('The generated source exceeds the controlled inspection boundary.');
    if (build.submission.candidate.code.exportName !== source.requirement.name)
      throw new Error('The generated export does not match the design requirement.');
    const archive = gzipSync(Buffer.from(build.sourceText, 'utf8'), { level: 9 });
    return {
      content: {
        sha256: createHash('sha256').update(archive).digest('hex'),
        sizeBytes: archive.byteLength,
        mediaType: 'application/gzip',
      },
      sourceEvidence: {
        buildLogArtifactId: 'build:mock-figma:promotion-banner-auto',
        sbomArtifactId: 'sbom:mock-figma:promotion-banner-auto',
      },
    };
  }
}

export function createDefaultThreadAutomationAdapters(): ThreadAutomationAdapters {
  return {
    designSource: new MockFigmaDesignSourceAdapter(),
    componentBuilder: new ControlledTemplateBuilderAdapter(),
    artifactInspector: new ServerSha256ArtifactInspectorAdapter(),
  };
}
