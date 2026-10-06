"use strict";

/**
 * Copy and CTAs when employer deck has no next card.
 * @param {{ invitedInMatches: number }} opts
 */
function getDeckEmptyState({ invitedInMatches }) {
  if (invitedInMatches > 0) {
    return {
      title: "Колода пуста",
      help:
        "Все подходящие кандидаты уже получили приглашение по этой потребности. Откройте приглашения или посмотрите полный список.",
      actions: [
        { href: "/employer/invitations", label: "Приглашения", primary: true },
        { href: "/employer/list", label: "Список", primary: false },
        { href: "/employer/need", label: "Изменить потребность", primary: false },
      ],
    };
  }
  return {
    title: "Колода пуста",
    help:
      "Нет кандидатов для свайпа по текущим фильтрам. Проверьте потребность, снимите фильтры в списке или загляните в отложенные.",
    actions: [
      { href: "/employer/list", label: "Список", primary: true },
      { href: "/employer/deferred", label: "Отложенные", primary: false },
      { href: "/employer/need", label: "Изменить потребность", primary: false },
    ],
  };
}

module.exports = { getDeckEmptyState };
