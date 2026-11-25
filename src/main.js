import { createSkipToPreviousPromptFeature } from './features/skip-to-previous-prompt.js';

export function bootstrapGeminiShortcuts(doc = document) {
  const features = [
    createSkipToPreviousPromptFeature({ doc, observe: true }),
  ];

  for (const feature of features) {
    feature.init();
  }

  return {
    features,
    destroy() {
      for (const feature of features) {
        feature.destroy();
      }
    },
  };
}

if (typeof document !== 'undefined') {
  bootstrapGeminiShortcuts(document);
}
