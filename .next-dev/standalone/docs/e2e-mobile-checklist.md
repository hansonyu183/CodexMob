# Mobile E2E Checklist

## Preconditions

- Server is running with `codex login` completed.
- `.env.local` includes valid `APP_ACCESS_CODE`.
- Open app in mobile viewport (or real phone).

## Scenarios

1. Launch and auth status
   - Open app.
   - Verify header shows runtime status.
   - Open settings and confirm auth method is displayed.

2. New conversation and stream
   - Create a new conversation.
   - Send a prompt.
   - Verify assistant message appears and grows during stream.

3. Stop generation
   - Start a long prompt.
   - Tap `停止`.
   - Verify generation stops and partial content remains.

4. Regenerate
   - Tap `重新生成`.
   - Verify a new assistant response is produced.

5. Conversation management
   - Rename conversation and verify list updates.
   - Delete conversation and verify fallback conversation is loaded.

6. Theme persistence
   - Switch theme in settings.
   - Refresh page.
   - Verify selected theme is retained.

