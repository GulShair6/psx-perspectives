UPDATE stock_catalog SET aliases=json_insert(aliases,'$[#]','Meezan','$[#]','میزان') WHERE symbol='MEBL';
