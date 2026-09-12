// Разбор модели телефона из текстовой метки.
//
// ЗАЧЕМ. Модель — сильный фактор: по данным слабые аппараты дают €36–106,
// а Pro/новые €400–650. Но отдельного поля «модель» в БД нет: оператор пишет
// метку свободным текстом при привязке телефона («Чёрный 16 про»). Заводить
// поле — миграция плюс ручной ввод; разбирать метку — чистая функция, которую
// можно покрыть тестами и в любой момент улучшить, ничего не переписывая.
//
// Метки в базе (46 шт на 13.09.2026) реально выглядят так:
//   «15 черный» · «Черный 14 про» · «Белый 12 про Макс» · «Серый 13 про макс»
//   «iPhone 11 Pro (серый)» · «iPhone 12 Pro (без крышки)» · «iPhone 12 (черный)»
//   «Черный 12 мини» · «Белый 16e» · «Золотой xs max» · «Синий 14 Plus» · «Белый Xr»
// Порядок слов свободный, язык смешанный, регистр любой — поэтому ищем
// признаки по всему тексту, а не разбираем позиционно.
//
// ⚠️ Разбор — ПОДСКАЗКА, а не истина. Метку пишет человек, опечатка или новая
// формулировка дадут null. Аналитика обязана уметь работать с «модель неизвестна»,
// а не молча терять такие телефоны.

export type Tier = 'pro-max' | 'pro' | 'plus' | 'max' | 'mini' | 'e' | 'base';

export interface PhoneModel {
  /** Поколение: '11'…'17', 'XS', 'XR', 'SE'. null — не распознано. */
  gen: string | null;
  /** Разновидность внутри поколения. */
  tier: Tier;
  /** Человекочитаемое имя: «iPhone 13 Pro Max». null, если поколение неизвестно. */
  name: string | null;
}

const UNKNOWN: PhoneModel = { gen: null, tier: 'base', name: null };

export function parsePhoneModel(label: string | null | undefined): PhoneModel {
  if (!label) return UNKNOWN;

  // Разбираем по СЛОВАМ, а не регулярками по всей строке.
  // ⚠️ Причина конкретная: в JavaScript `\b` считает «словом» только латиницу
  // и цифры, поэтому /\bпро\b/ НЕ находит кириллическое «про» после пробела.
  // На этом разбор «Черный 14 про» молча давал «iPhone 14» вместо «iPhone 14 Pro».
  // Со списком слов таких сюрпризов нет.
  const tokens = label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const has = (t: string) => tokens.includes(t);
  const hasSeq = (a: string, b: string) => {
    const i = tokens.indexOf(a);
    return i >= 0 && tokens[i + 1] === b;
  };

  // ---- поколение ----
  let gen: string | null = null;
  let tier: Tier | null = null;

  if (has('xs')) gen = 'XS';
  else if (has('xr')) gen = 'XR';
  else if (has('se')) gen = 'SE';
  else {
    // «16e» — поколение и разновидность слиты в одно слово.
    const e = tokens.find((t) => /^\d{2}e$/.test(t));
    if (e) {
      gen = e.slice(0, 2);
      tier = 'e';
    } else {
      // Ровно две цифры отдельным словом и в разумном диапазоне поколений:
      // «111» — опечатка в метке, «2024» — год, моделью их не считаем.
      const num = tokens.find((t) => /^\d{2}$/.test(t) && Number(t) >= 10 && Number(t) <= 20);
      if (num) gen = num;
    }
  }

  // ---- разновидность ----
  // Порядок важен: «про макс» проверяется раньше «про», иначе Pro Max
  // схлопнется в Pro и смешает разные по силе аппараты.
  if (tier === null) {
    if (hasSeq('про', 'макс') || hasSeq('pro', 'max')) tier = 'pro-max';
    else if (has('про') || has('pro')) tier = 'pro';
    else if (has('plus') || has('плюс')) tier = 'plus';
    else if (has('макс') || has('max')) tier = 'max';
    else if (has('мини') || has('mini')) tier = 'mini';
    else tier = 'base';
  }

  return { gen, tier, name: gen ? buildName(gen, tier) : null };
}

function buildName(gen: string, tier: Tier): string {
  switch (tier) {
    case 'pro-max':
      return `iPhone ${gen} Pro Max`;
    case 'pro':
      return `iPhone ${gen} Pro`;
    case 'plus':
      return `iPhone ${gen} Plus`;
    case 'max':
      return `iPhone ${gen} Max`;
    case 'mini':
      return `iPhone ${gen} mini`;
    case 'e':
      return `iPhone ${gen}e`;
    default:
      return `iPhone ${gen}`;
  }
}

/**
 * Группа модели — для аналитики, когда по конкретной модели телефонов мало.
 * Сознательно НЕ называем группы «сильная/слабая»: силу должны показывать
 * данные, а не наше предположение. Здесь только конструктивный признак.
 */
export function modelGroup(m: PhoneModel): 'pro' | 'compact' | 'base' | 'unknown' {
  if (!m.gen) return 'unknown';
  if (m.tier === 'pro' || m.tier === 'pro-max' || m.tier === 'max') return 'pro';
  if (m.tier === 'mini' || m.tier === 'e') return 'compact';
  return 'base';
}
