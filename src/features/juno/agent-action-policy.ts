/**
 * Literal action-intent detection.
 *
 * The model cannot ask for an action; only the customer's own text can. These
 * patterns are deliberately narrow: a mention of a transcript alone is not
 * enough, and a false negative simply leaves the thread for a person.
 */

export type RequestedAgentAction = "send_transcript";

export function detectRequestedAgentAction(text: string): RequestedAgentAction | null {
  const directTranscript =
    /\b(?:email|send|share)\b[^.?!]{0,40}\btranscript\b/i;
  const copy =
    /\b(?:transcript|copy)\b[^.?!]{0,30}\b(?:this|our)\b[^.?!]{0,20}\b(?:conversation|chat|thread)\b/i;
  return directTranscript.test(text) || copy.test(text) ? "send_transcript" : null;
}
