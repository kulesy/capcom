# Attach any file by saving it and mentioning its path, as Desktop does

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-23
- Tags: prompt-box, files, uploads, transcripts, permissions

## Context and Problem Statement

Capcom's prompt box took images and nothing else. The [only-client decision](20261015-capcom-is-the-only-client.md) listed attached files as the next part of the prompt box, and the owner sends PDFs, spreadsheets, notes and Word documents to Claude all the time. How does a file get from the browser to the CLI, under what limits, and what does Claude do with it when it gets there?

Desktop starts a message with `@"/abs/path/to/file"` for each attached file, and the CLI expands the mention itself. On CLI 2.1.309 it puts a text file or a CSV into the message as a Read result. For a PDF it adds only a line saying the file was read, with its path and size, and no content. For a Word document it adds nothing. With Read and Bash not allowed, Haiku and Sonnet could not name the word in a PDF that was mentioned by path alone. Sent as a document block next to the text, the same PDF let Haiku name it with no tools.

## Decision Drivers

- The CLI is what reads a file, so Capcom should hand it the mention it already expands rather than read files itself.
- The messages the page loads have to stay small, as the [images decision](20261015-images-in-the-prompt-box.md) found. A file's bytes should not sit in a transcript line.
- Messages sent from Desktop or a terminal with mentions have to show as cards too.
- A file Claude cannot read without running a command should not cause a permission prompt in a mode that auto-approves reads.
- A PDF the API refuses must not break the chat. The CLI sends every earlier block again on each turn, so one refused block fails every later turn.
- No dependency and no build step, and it has to work on a phone.
- A new page served by a server that has not been restarted has to keep working as it did.

## Considered Options

1. Save the file in Capcom's state folder and start the message with its path, as Desktop does, and send a small PDF as a document block too
2. Send every file as a content block in the request, as images are
3. Read the file in the browser and paste its text into the message

## Decision Outcome

Chosen option: "Save the file in Capcom's state folder and start the message with its path, and send a small PDF as a document block too", because the CLI already expands that mention, the transcript holds a path instead of bytes for everything but a small PDF, and Desktop's own messages have the same shape, so one reader handles both.

- **Uploading.** `POST api/uploads` takes one file as the raw request body, with its name in `x-file-name`, percent-encoded. Capcom streams the body to `uploads/` in its state folder (for example `~/.config/capcom/uploads`) as `<uuid>.<ext>`, written under a `.part` name and renamed when the body ends, with a `<uuid>.meta.json` beside it that holds the name, type and size. The folder is mode 0700 and the files 0600. The name is stored and shown but never used in a path, and the extension is kept only when it is letters and digits. The route answers with the id, name, type and size.
- **Limits.** Each file is at most 30 MB, which is claude.ai's limit, and a message holds at most 10 files. The server refuses with 413 from `content-length` when it can, and while streaming when it cannot, and it drops what it has written. The sign-in is checked before the body and again after it, because a new password can arrive while a large file is coming, and then nothing is kept. A body that sends nothing for 60 seconds is dropped with a 408, its request destroyed and its part file removed. The server's own request timeout is left at Node's default of 300 seconds, which caps a whole upload. `GET api/uploads` returns `{ maxBytes, maxFiles }`, and the page asks once at load. The body limit of every other route stays at 1 MB, and the image routes keep theirs.
- **Sending.** `send` and `api/new` take `files: [id]`. An id that is not an upload on disk gives a 400 and nothing is sent. The prompt is `@"/abs/a.html" @"/abs/b.md"`, then a newline, then the typed text, or the mentions alone when there is no text. Files and images can go in the same message, and a message is written to the CLI as images first, then documents, then the text. A new session with files and no text takes the first file's name as its title, or "Files" when there are several, and the session list reads the owner's file names from the sidecars, not the saved `<uuid>.<ext>`. Text that starts with a slash command, such as `/compact`, is refused with a 400 ("Send a slash command on its own, without files.") on `send` and `api/new` when files are attached, because `@"..."` before the command stops the CLI reading it as one. The page puts the message back in the box.
- **Word documents.** The CLI reads nothing from `.doc`, `.docx`, `.odt` or `.rtf`, so Capcom converts each with `/usr/bin/textutil -convert txt -stdout` when it arrives and keeps the result as `<uuid>.<ext>.txt`. The prompt mentions the original and then the text copy. A file that textutil cannot read is sent without a copy.
- **PDFs.** On upload of a `.pdf`, Capcom runs a short JavaScript for Automation script through `/usr/bin/osascript` (no shell, a 15 second timeout, an 8 MB output limit), which opens the file with macOS's PDFKit and prints the page count and the text, in about 60 ms for a small file. That adds no dependency. The page count goes in the sidecar as `pages`, and a PDF that is encrypted but opens without a password also gets `encrypted: true`. A PDF that needs a password, one PDFKit cannot open and a file named `.pdf` that is not one get no `pages`. When the text is not blank it is written as `<uuid>.pdf.txt`, owner-only, and the card list hides it as it does a Word copy.
- **Document blocks.** At send time a PDF with 1 to 20 pages, at most 3 MB and not encrypted goes as `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }`, read from the file then. Its mention stays in the text and its text copy is not mentioned, so Claude gets the content once. The limits hold for all the documents in a message together, in the order attached, and for all the documents of one chat together at 40 pages and 10 MB. The chat's running total is kept in `documents.json` in the state folder (mode 0600, written to a temporary file and renamed), by session id, and a new session is recorded under its id once it has started. A PDF that would take either total past its limit goes by path with its text copy instead. The per-chat limits sit well under the API's 100 pages and 32 MB per request, because the CLI sends every earlier block again on each turn, base64 is a third larger than the file, and each page costs context. A PDF over the limits, an encrypted one and one with no page count go by path, with a text copy when there is one. A scan within the limits still goes as a document. `Chat.send` writes the images, then the documents, then the text, and a message can be documents and text alone. A document block in a user line adds no text and no "[document]" mark to the transcript, and the card comes from the mention. The picture scan skips such a line, because it holds neither a `"tool_use"` nor an `"image"`.
- **Reading.** A leading run of `@"/path"` mentions, ended by a newline or the end of the text, becomes `files: [{ name, type, size, path }]` on the user's item and is taken off the text. A path inside the uploads folder is described by its sidecar, and a text copy is left out of the list because it belongs to its original. Any other path, such as one Desktop wrote, shows by its file name with no size, because Capcom does not `stat` a path outside its own folder and a mention of a path on a volume that has gone cannot stall a read. A mention anywhere but the start stays in the text. The reader, `leadingMentions`, lives in `public/ui/files.js` beside the card code, and `lib/uploads.mjs` imports it, so the page and the server read the shape the same way.
- **The page.** The + button, a paste and a drop take any file. Images go as before. A file shows at once as a card with its name, kind and size, reads "Uploading..." until the server has it, and can be taken off, which stops the upload. Send waits for the cards. A transcript draws the same card without the cross, with the path as its tooltip. An image of a type the API does not take, such as HEIC, is redrawn in a canvas and sent as an image when the browser can read it, and goes up as a file when it cannot. An SVG is a file.
- **Old servers.** The page asks `api/uploads` once at load. When that fails, it behaves exactly as before: images only, "Attach images" on the button, and the old notice for anything else. A pick or drop of anything but the four image types asks again, so a server that gains the route is noticed without a reload. A paste keeps the image-only filter before it stops the browser's own paste, so a pasted file that is not an image behaves exactly as it did, and asks in the background so the next paste works once the server has restarted. The sending bubble of a message with no files attached strips a leading typed mention and counts it as a file, as the transcript does, so it clears.

What the CLI did with each kind, checked on 2.1.309 with Haiku 5.5, a text file, a CSV, a PDF and a Word document in one message, in each of the five permission modes (manual, accept edits, plan, auto and bypass):

- **No prompts.** No mode asked for approval for any of the four files. The CLI inlined the text file, the CSV and the Word document's text copy with no tool call.
- **A PDF by path alone is not read reliably.** Before document blocks, Haiku opened the PDF with Read in three of the five modes and missed it in two. In a separate run on a PDF alone, Opus read it and Sonnet did not. That is why a PDF gets a document block and a text copy.
- **A PDF with a document block or a text copy was read in every run.** A 1-page PDF (document block) and a 25-page PDF with the secret on page 23 (text copy, no block) were each sent twice in manual and in accept edits mode, which are the two modes that missed the PDF before. Haiku named the secret all 8 times, called no tool, and no approval appeared. The next turn of a chat with a document block also worked.
- **Claude sees the saved name.** The model gets `<uuid>.pdf`, not `Quarterly report.pdf`, so it cannot say the file's real name unless the typed text does.
- **A message sent while a tool runs is not expanded.** With a Bash tool running `time.sleep(25)`, a CSV and then a 1-page PDF (document block) were sent in bypass permissions mode. The CLI wrote each as a `queued_command` attachment and showed Claude only the text, "The user sent a new message while you were working:" and the typed words with the `@"..."` mention left as it was. The CSV was not put in the message, the PDF's document block never reached Claude, and Haiku called Read on both files to answer. Read of a file in the uploads folder, outside the chat's folder, asked for no approval in manual, accept edits, plan or auto mode either. So a message sent while Claude works carries no document block, and a PDF in it is mentioned with its text copy, as a longer PDF is. Claude still has to choose to Read it. The transcript line keeps the mention, so the cards still show. Two messages that were queued before the next turn began, not during a tool, came back as one user line, so the second one's mention was no longer at the start and showed as plain text. No workaround is built for that.
- **Not checked.** A spreadsheet, a slide deck or any other binary reaches Claude as a path only. Opening one takes a command, which asks in the modes that ask. That was not run. A PDF that PDFKit reads as 20 pages or fewer but the API refuses for another reason was not tried either.

### Consequences

- ✅ The messages the page loads carry a path and no file data.
- ✅ Files sent from Desktop or a terminal show as cards with no extra work.
- ✅ A text file, a CSV and a Word document reach Claude without a tool call, and nothing asked for approval in any mode.
- ✅ A message can be files alone, or files with images.
- ✅ A page newer than its server loses nothing.
- ✅ A small PDF reaches Claude as a document in the message, with no tool call.
- ❌ A PDF over 20 pages or 3 MB reaches Claude as text only. Layout, tables and pictures are lost, a scan has no text at all, and Claude has only its path. The limits are low on purpose, and a PDF that the API would take is still sent as text.
- ❌ The per-chat total counts what Capcom sent. A chat that Desktop or a terminal also sent PDFs to, or one started before this ledger existed, starts from what Capcom has recorded, and a deleted `documents.json` starts every chat from nothing.
- ❌ A slash command cannot go with files, and the owner has to send the command alone.
- ❌ A file sent while Claude is running a tool is not read by the CLI until Claude opens it with Read, and a PDF's document block is dropped for that message, so the file may need a command and an approval in the modes that ask.
- ❌ PDFs need macOS, because the page count and text come from PDFKit. Elsewhere a PDF has no sidecar page count, goes by path and has no text copy.
- ❌ A transcript line with a document block holds up to 4 MB of base64, and the messages route parses the whole line each time that part of the chat opens.
- ❌ Claude never sees a file's real name, only the UUID Capcom saved it under.
- ❌ A spreadsheet, a slide deck or an archive reaches Claude as a path with nothing to read it, and a command to open one asks in the modes that ask.
- ❌ Uploads stay on disk. A file that was attached and never sent stays, and so does a `.part` file left by a crashed server. Nothing sweeps the folder, so the owner clears it by hand.
- ❌ A first line the owner types that looks like a mention, such as `@"/etc/hosts"` and a newline, shows as a file card with no size. The CLI expands it too, so the card matches what Claude gets, but it may surprise the person who typed it.
- ❌ The converted text of a Word document is only as good as `textutil`. Tables and layout flatten, and macOS is required.
- ❌ A request can reach 30 MB, and a proxy in front of Capcom has to allow that on `api/uploads`.

## Pros and Cons of the Options

### Save the file and start the message with its path

- ✅ The shape Desktop uses, so the CLI, the transcript and the reader are the same for both
- ✅ Nothing large in the request or the transcript, except for a small PDF
- ❌ Files pile up on disk, and the model sees the saved name
- ❌ A PDF alone is not reliably read, so it needs the text copy and the document block

### Send every file as a content block

- ✅ The file would be part of the message, and a PDF sent this way was read by Haiku with no tools
- ❌ Only some types have a block, such as PDF and plain text, and a spreadsheet or a Word document has none
- ❌ The file's bytes would sit in the transcript line, which the images decision avoided, and a block the API refuses fails every later turn. Used for a small PDF only.

### Paste the file's text into the message

- ✅ Needs no server route
- ❌ Works for text only, and a long file would fill the message and the transcript

## Links

- [Make Capcom the only client](20261015-capcom-is-the-only-client.md), which listed attached files as next
- [Send pasted images as content blocks](20261015-images-in-the-prompt-box.md), whose limits and sending bubble the files follow
- [Match Desktop's flow for new sessions, settings, stopping and tool calls](20261014-desktop-like-prompt-box-flow.md)
- [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md), whose sign-in the upload route checks twice
