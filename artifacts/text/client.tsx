import { Artifact } from '@/components/create-artifact';
import { DiffView } from '@/components/diffview';
import { DocumentSkeleton } from '@/components/document-skeleton';
import { Editor } from '@/components/text-editor';
import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import { toast } from 'sonner';

// No specific metadata for text artifact after suggestion removal.
// If metadata were needed, an interface could be defined here.

export const textArtifact = new Artifact<'text', Record<string, never>>({
  kind: 'text',
  description: 'Useful for text content, like drafting essays and emails.',
  initialize: async ({ documentId, setMetadata }) => {
    // Suggestions functionality removed.
    // Initialize with empty metadata or handle as needed.
    setMetadata({});
  },
  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    // Suggestion stream part handling removed.

    if (streamPart.type === 'text-delta') {
      setArtifact((draftArtifact) => {
        return {
          ...draftArtifact,
          content: draftArtifact.content + (streamPart.content as string),
          isVisible:
            draftArtifact.status === 'streaming' &&
            draftArtifact.content.length > 400 &&
            draftArtifact.content.length < 450
              ? true
              : draftArtifact.isVisible,
          status: 'streaming',
        };
      });
    }
  },
  content: ({
    mode,
    status,
    content,
    isCurrentVersion,
    currentVersionIndex,
    onSaveContent,
    getDocumentContentById,
    isLoading,
    metadata,
  }) => {
    if (isLoading) {
      return <DocumentSkeleton artifactKind="text" />;
    }

    if (mode === 'diff') {
      const oldContent = getDocumentContentById(currentVersionIndex - 1);
      const newContent = getDocumentContentById(currentVersionIndex);

      return <DiffView oldContent={oldContent} newContent={newContent} />;
    }

    return (
      <>
        <div className="flex flex-row py-8 md:p-20 px-4">
          <Editor
            content={content}
            // suggestions prop removed as suggestion system is deprecated
            isCurrentVersion={isCurrentVersion}
            currentVersionIndex={currentVersionIndex}
            status={status}
            onSaveContent={onSaveContent}
          />

          {/* Conditional rendering for suggestions removed */}
        </div>
      </>
    );
  },
  actions: [
    {
      icon: <ClockRewind size={18} />,
      description: 'View changes',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('toggle');
      },
      isDisabled: ({ currentVersionIndex, setMetadata }) => {
        if (currentVersionIndex === 0) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <CopyIcon size={18} />,
      description: 'Copy to clipboard',
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard!');
      },
    },
  ],
  toolbar: [
    {
      icon: <PenIcon />,
      description: 'Add final polish',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add final polish and check for grammar, add section titles for better structure, and ensure everything reads smoothly.',
        });
      },
    },
    {
      icon: <MessageIcon />,
      description: 'Request suggestions',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add suggestions you have that could improve the writing.',
        });
      },
    },
  ],
});
