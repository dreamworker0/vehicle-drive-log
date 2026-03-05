---
description: Firestore Rules + Storage Rules만 Firebase에 배포
---

// turbo-all

1. Deploy security rules (Firestore + Storage):
```
firebase deploy --only firestore:rules,storage
```
Working directory: `.`
