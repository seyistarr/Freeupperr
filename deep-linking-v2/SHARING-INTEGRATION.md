# Sharing integration checklist

Before enabling short links in the live share UI, deploy and test a public-only post-ID-to-short-code lookup endpoint. Do not expose private post metadata. Ensure failure falls back to existing UUID links. Validate video, image, text, deleted, hidden and private cases. Keep the PR in Draft until the database migration is reviewed and deployed safely.
