# Send pasted images as content blocks and show transcript images through an endpoint

- Status: Accepted, amended 2026-10-17 and 2026-10-18
- Deciders: Eli
- Date: 2026-10-15
- Tags: prompt-box, images, transcripts, stream-json

## Context and Problem Statement

Capcom could not take an image, and the owner pastes screenshots into chats constantly. That was the main thing keeping Capcom from replacing Desktop. Two questions followed. How does an image get from the browser to the CLI, and under what limits? And how does the page show the images in a transcript, whoever sent them?

The CLI saves an image as base64 text inside the line of the user's message, so one line can hold several megabytes. The messages route turns a 2 MB stretch of the file into items on every open, and the lines added since on every update.

## Decision Drivers

- The API takes at most 5 MB for one image.
- The messages the page loads are read again and again, so they have to stay small.
- Messages sent from Desktop or a terminal, and messages queued while Claude was mid-turn, have to show their images too.
- No dependency and no build step, and it has to work on a phone.

## Considered Options

1. Scale in the browser, send base64 in the request, and serve transcript images from an endpoint
2. Put each image's base64 into the messages the page loads
3. Save each pasted image to a file and give Claude its path

## Decision Outcome

Chosen option: "Scale in the browser, send base64 in the request, and serve transcript images from an endpoint", because the image goes into the message as the CLI expects, the messages stay small, and every transcript is read the same way.

- **Sending.** `send` and `api/new` take `images: [{ mediaType, data }]` next to the text. `Chat.send` writes the user message with the image blocks first and the text block after, or with no text block when there is no text. The body limit rises for those two routes only, to ten images of 5 MB as base64 plus 1 MB. Every other route keeps 1 MB.
- **Limits.** PNG, JPEG, GIF and WebP, at most 10 to a message, each under 3.75 MB, which is 5 MB as base64. The page scales anything over 2000 pixels on its long edge down in a canvas, keeps PNG, and falls back to JPEG only when a PNG is too big. An image within both limits goes as it is, so a GIF stays animated. The server checks the same limits again and reads the type from the bytes, so a WebP saved under a `.png` name goes to Claude as a WebP.
- **Reading.** An item for a user message carries `images: [{ ref, type }]`, and `GET api/sessions/<id>/images/<ref>` returns the bytes with the right content type. A ref is the byte offset of the transcript line, the image's position among that message's images, and the entry's uuid. The endpoint reads that one line and refuses the ref when the uuid does not match, so a rewritten file cannot show the wrong image. That also lets the browser keep each image for good.
- **Mid-turn.** The CLI saves a message queued while Claude works as a `queued_command` attachment. With images, its prompt is a list of content blocks instead of a string. The reader handles both. Checked on CLI 2.1.300.
- **Sending bubble.** While a message is on its way, its bubble shows the attached images from the browser's own copy. The transcript's copy replaces it when the line arrives.

**Amended 2026-10-17.** The pictures a tool returns to Claude show too, such as a browser screenshot or an image file it reads. They sit in the `tool_result` blocks of a user line, so the item for a tool's result carries `images: [{ ref, type }]` as a user message does, and the page copies them onto the tool's own item. Their refs read `<offset>.r<n>.<uuid>`, where `n` counts every image block across the results on the line, whether the page can draw it or not, so a type added later moves no ref. A ref on a user message keeps its form, because the browser keeps each image for a year and a ref has to name the same picture for ever. A picture the page cannot draw still reads "[image]" in the tool's output.

**Amended 2026-10-18.** The viewer steps through every picture in the chat, those in history the page has not loaded included. `GET api/sessions/<id>/images?before=<offset>` lists the pictures above the loaded part, in the order the thread draws them, as items that carry a kind, a tool's name and `images: [{ ref, type }]`. A tool's pictures sit at its call, as on the page, even when the results of parallel calls come back out of order. The server parses only the lines that hold a tool call or an image block, keeps the list for each file, and on a later ask reads only the lines added since. The page asks when the viewer opens and keeps the answer until Load earlier moves the offset. The list uses the refs the single-picture route already serves, so no ref changes meaning.

### Consequences

- ✅ The messages the page loads carry no image data.
- ✅ Images sent from Desktop or a terminal show with no extra work.
- ✅ A message can be images alone.
- ❌ Opening an image reads its whole transcript line, which can be several megabytes, and parses it. The browser keeps the result, so it happens once for each image.
- ❌ The `queued_command` shape is observed, not documented. Recheck it after CLI updates.
- ❌ The CLI re-encodes any image over about 0.5 MB before it reaches the API. On CLI 2.1.300 a 500 KB PNG went through unchanged and a 600 KB one did not. A large screenshot therefore reaches Claude re-encoded whatever Capcom sends, and Desktop's transcripts hold nothing over 656 KB of base64.
- ❌ Capcom limits each image and the number of images, not their total. Ten images at the limit make a request of about 52 MB, and a proxy in front of Capcom has to allow that.
- ✅ Previous carries on into history the page has not loaded, and each picture loads from its own address with no scrolling.
- ❌ The first list for a large transcript blocks the server for one pass over the file, about 160 ms for 132 MB. Later lists for the same file take about 1 ms.
- ❌ The server skips lines that do not contain `"tool_use"` or `"image"` as bytes. That holds because the CLI writes each line with `JSON.stringify`, which leaves letters unescaped. Recheck it after CLI updates.
- ❌ When a call sits above the loaded part and its result lands after the page asked for the list, its pictures stay out of the count until Load earlier or a reload.

## Pros and Cons of the Options

### Scale in the browser, send base64, serve images from an endpoint

- ✅ Small messages, and one way to read every transcript
- ❌ A request can reach about 52 MB

### Put each image's base64 into the messages

- ✅ No second request for an image
- ❌ A screenshot is 100 KB to 700 KB of text, so a session with screenshots would load several times more data, and the base64 would sit in every message

### Save each image to a file and give Claude its path

- ✅ Nothing large in the request
- ❌ Claude has to read the file with a tool, so the image is not part of the message, and the transcript has nothing to show

## Links

- [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md)
- [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md)
- [Match Desktop's flow for new sessions, settings, stopping and tool calls](20261014-desktop-like-prompt-box-flow.md), whose mid-turn messages carry images too
- [Attach any file by saving it and mentioning its path](20261023-attach-files-by-path.md), which sends other files by path, and a small PDF as a document block as well
