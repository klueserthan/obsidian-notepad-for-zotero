// Bundled into plugin/content/core.bundle.js (IIFE, global ZONCore) and loaded
// into the Zotero window like the editor bundle. Gives the plugin the pure
// template/merge logic (which depends on nunjucks + dayjs) without those living
// in the bootstrap.
export { render } from "../src/render.js";
export { buildItemData, filenameFields, zoteroSelectURI, ensureZoteroLink } from "../src/item-data.js";
export { renderAnnotationsSection, renderAnnotationsContext, mapZoteroAnnotation } from "../src/annotations.js";
export { syncBlocks, makeBlock, parseBlocks } from "../src/blocks.js";
export { DEFAULT_FORMATS, FIELD_FORMATS } from "../src/formats.js";
export { parseTemplateFile, templateKind, templateUserOwnedKeys } from "../src/templates.js";
export { previewTemplate, cleanPreview, stripForPreview, paletteContextAt, BLOCK_VARIABLES, ITEM_VARIABLES, FRONTMATTER_FIELDS, FIELD_BLOCKS, ANNOTATION_BLOCKS, STARTER_NOTE, STARTER_FORMAT, SAMPLE_ITEM, SAMPLE_ANNOTATIONS, blockConfigAt, annotationMarkerOpen, annotationBlockText, BLOCK_COLOURS, BLOCK_TYPES, BLOCK_STYLES, BLOCK_PARTS, NAMED_FORMATS, FRONTMATTER_VALUES, frontmatterFieldText, frontmatterFieldKeys, addFrontmatterField, removeFrontmatterField, FIELD_VARS, fieldBlockVarText, colourRouteText, UPDATABLE_FIELDS, fieldBlockMarkerOpen, fieldBlockTextFor, fieldOptionId } from "../src/builder.js";
export { parseManifest, hasManifest, applyManifest, setManifestEntry, removeManifestEntry, buildManifestFromScaffold, writeManifest, MANIFEST_KEY, getTagField, setTagField, getAttachmentFolder, setAttachmentFolder } from "../src/manifest.js";
export { findMarkerRanges, rangeRevealed } from "../src/markers.js";
export { findFrontmatterRange, findHeadingRanges, findLinkRanges, findEmphasisRanges, findImageEmbedRanges } from "../src/preview.js";
export { COLOR_NAMES } from "../src/colors.js";
export { stripMarkers, stripFrontmatter, withSummaryTitle } from "../src/strip-markers.js";
export { mdToHtml } from "../src/md-html.js";
export { composePreviewHtml, llmPlaceholderHtml, PLACEHOLDER_NOTE } from "../src/compose-preview.js";
// `hasLLMBlocks` is aliased to `composeHasLLMBlocks` — the llm-blocks.js export of
// the same name takes note text, this one takes a compose gate state.
export { composeKey, blockFingerprint, blocksFingerprint, createComposeState, reconcileComposeState, hasLLMBlocks as composeHasLLMBlocks, isResolved, unresolvedBlocks, canGenerate, resolveAll, setResolution, clearResolutions, orderedOutputs, placeholderInfo, generateBlockedReason } from "../src/compose-gating.js";
export { buildCrossrefURL, pickBestMatch, normalizeTitle, titleSimilarity, normalizeDOI, crossrefYear, extractYear } from "../src/crossref.js";
export { sanitizeFilename } from "../src/paths.js";
export { LLM_DEFAULTS, isLLMConfigured, canAutoRun, sanitizeLLMSettings, buildChatCompletionsURL, buildLLMHeaders, buildChatCompletionsPayload, buildTestConnectionPayload, parseChatCompletionsResponse, sanitizeError, sanitizeLogMetadata } from "../src/llm.js";
export { SUPPORTED_CONTEXTS, parseLLMContext, hasLLMBlocks, parseLLMBlocks, validateLLMBlocks } from "../src/llm-blocks.js";
export { resolvePrimaryPDFFulltext, renderFulltextContext } from "../src/fulltext.js";
export { GROUNDING_SYSTEM_PROMPT, RUNNABLE_CONTEXTS, LLM_RUN_ERRORS, buildLLMMessages, normalizeLLMOutput, classifyLLMOutput, prepareLLMRun, applyLLMOutputs, decideLLMAction, executeLLMBlocks } from "../src/llm-runner.js";
export { summaryNoteStaleness } from "../src/staleness.js";
export { planBulk } from "../src/bulk.js";
