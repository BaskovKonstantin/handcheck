# HandCheck — UX (rev.5)

Copy is **Russian**. No numeric ratings, scores, or integrity hints in any cabinet.

## Landing `/`

- Title: **«Категория по навыку. Приглашение с вилкой.»**
- Nav: Кандидатам, Работодателям, Войти, «Начать»
- Three steps: профиль и бэкграунд → короткие ответы и рабочая задача → приглашения от компаний
- Live stats from `/api/stats`; zero shows demo figure with «в демо»

## Auth `/auth`

Register (email, password, role) → confirm code → login.

## Candidate cabinet (5 nav items)

| Route | Screen |
|-------|--------|
| `/candidate/today` | Today summary, category label |
| `/candidate/past` | History placeholder |
| `/candidate/tasks` | Battery: QuickProbe + WorkSim |
| `/candidate/invitations` | Incoming invites, accept/decline |
| `/candidate/calls` | Calls list, no analysis/transcript |

## Employer cabinet (5 nav items)

| Route | Screen |
|-------|--------|
| `/employer/need` | Active need editor |
| `/employer/deck` | Single card, gestures |
| `/employer/list` | Same pool as rows |
| `/employer/deferred` | `later` reviews |
| `/employer/invitations` | Outgoing |
| `/employer/calls` | Calls + 3-phrase analysis |

## Call room `/call/:invitationId`

Consent checkbox (fixed legal text) → Join → video → End.

## Deck rules

No photo. Name, category pill, domains, stack, task phrases, two explanation lines.
