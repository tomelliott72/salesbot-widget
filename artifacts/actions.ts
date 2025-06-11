'use server';

// This file previously contained a getSuggestions server action.
// The underlying database functionality for suggestions (e.g., getSuggestionsByDocumentId)
// has been removed as the 'suggestion' and 'document' tables were deprecated.
// Therefore, any server actions related to suggestions are no longer valid and have been removed.
// If suggestion-like functionality is needed in the future, it will need to be re-implemented
// against the new Langflow-centric schema or other data sources.
