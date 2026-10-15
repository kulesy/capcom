// The unsent message lives outside every component, so it follows you from one session to the next
// and typing redraws only the prompt box.
let text = '';

export const draftText = () => text;
export const setDraftText = value => { text = value; };
