<template>
  <details class="text-xs text-slate-500">
    <summary class="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300">Что значит «валидный»?</summary>
    <p class="mt-1 leading-relaxed">
      Валидный код прошёл <b>структурную проверку GS1</b>: GTIN из 14 цифр, серийный номер,
      при необходимости AI&nbsp;91/92 (полный КИЗ) или AI&nbsp;93 (короткий GS1-код).
      Это <b>не подтверждение подлинности</b> в ГИС МТ: код может быть структурно валидным,
      но отсутствовать в системе. Онлайн-проверка в ГИС МТ не подключена.
    </p>
  </details>
</template>
