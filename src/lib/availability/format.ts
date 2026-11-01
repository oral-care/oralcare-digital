// Numbers on the Availability pages, in English (plan 4.12): thousands with a
// comma (3,339), shares with one decimal (23.1%), and changes with a sign
// (+12%). Pure module.

const counts = new Intl.NumberFormat("en-GB");

export const formatCount = (value: number): string => counts.format(value);

export const formatShare = (percent: number): string => `${percent.toFixed(1)}%`;

export const formatChange = (percent: number): string => (percent > 0 ? `+${percent}%` : `${percent}%`);
