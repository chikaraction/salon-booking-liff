-- Milestone 4b: 臨時営業日の営業時間(date_overrides に時刻を追加)
--
-- 経緯: date_overrides.is_open = true は当初「祝日だが営業する」の逃がし口として
-- 入れたが、それだけだと「毎週水曜が定休の店で今週の水曜だけ営業する」ができない。
-- その曜日の business_hours には open_time/close_time が無いため、休業判定は
-- 解けても営業時間が定まらず、客側の枠が1つも開かない(押せるのに何も出ない日)。
--
-- そこで臨時営業の日だけ営業時間を持てるようにする:
--   is_open = false(休業)      → 時刻はNULL(営業時間の概念がない)
--   is_open = true  + 時刻あり  → その日はこの時刻で営業する(短縮営業にも使える)
--   is_open = true  + 時刻なし  → その曜日の business_hours をそのまま使う
--                                 (祝日・第◯曜日の定休を打ち消すだけの用途)

alter table public.date_overrides
  add column open_time time,
  add column close_time time,
  -- 片方だけの指定は無意味(business_hours_times_required と同じ考え方)
  add constraint date_overrides_times_pair
    check ((open_time is null) = (close_time is null)),
  add constraint date_overrides_times_valid
    check (open_time is null or open_time < close_time),
  -- 休業日に営業時間があると矛盾する
  add constraint date_overrides_closed_has_no_times
    check (is_open or open_time is null);

comment on column public.date_overrides.open_time is '臨時営業日の開店時刻(店舗ローカル=JSTの壁時計時刻)。NULLならその曜日の business_hours に従う';
comment on column public.date_overrides.close_time is '臨時営業日の閉店時刻。open_time とペアで指定する';
