import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions
} from 'react-native';


// Types
type Eintrag = {
  id: number;
  date: string;
  start: string;
  ende?: string;
};

type SplitEntry = {
  id: string;
  firstId: number;
  secondId: number;
};

type EditMode = 'none' | 'start' | 'ende';

type OpenEntryInfo = {
  hasOpen: boolean;
  id: number | null;
};


// Storage Keys
const STORAGE_KEY_EINTRAEGE = '@zeit_erfassung_eintraege';
const STORAGE_KEY_SPLITS = '@zeit_erfassung_splits';


// Einfache ID-Erzeugung (stabiler als mehrfaches Date.now())
let NEXT_ID = Date.now();
const generateId = () => {
  NEXT_ID += 1;
  return NEXT_ID;
};


// Utility Functions
const getTodayDate = (): string => new Date().toISOString().split('T')[0];

const getWeekdayAbbr = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  const weekdays = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
  return weekdays[date.getDay()];
};

const getRoundedNow = (): string => {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.round(minutes / 5) * 5;
  now.setMinutes(roundedMinutes === 60 ? 0 : roundedMinutes);
  if (roundedMinutes === 60) now.setHours(now.getHours() + 1);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = (totalIn: number): string => {
  let total = Math.max(0, Math.min(totalIn, 23 * 60 + 55));
  const rounded = Math.round(total / 5) * 5;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const getNextDay = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

const getAdjustedDateForEntry = (entry: Eintrag, splits: SplitEntry[]): string => {
  const split = splits.find(s => s.firstId === entry.id || s.secondId === entry.id);
  if (!split) return entry.date;

  if (split.secondId === entry.id) {
    const date = new Date(entry.date + 'T00:00:00');
    date.setDate(date.getDate() + 2);
    return date.toISOString().split('T')[0];
  }

  return entry.date;
};

const getDurationMinutes = (start: string, ende?: string): number => {
  if (!ende) return 0;
  let startMin = timeToMinutes(start);
  let endMin = timeToMinutes(ende);
  if (ende === '24:00') endMin = 24 * 60;
  return Math.max(0, endMin - startMin);
};

const getDuration = (start: string, ende?: string): string => {
  if (!ende) return '-';
  const diffMinutes = getDurationMinutes(start, ende);
  if (diffMinutes <= 0) return '-';
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const getTotalDurationForEntries = (entries: Eintrag[]): string => {
  const totalMinutes = entries
    .filter(e => e.ende)
    .reduce((sum, e) => sum + getDurationMinutes(e.start, e.ende), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const getOpenEntryInfo = (eintraege: Eintrag[]): OpenEntryInfo => {
  const openEntries = eintraege.filter(e => !e.ende);

  if (openEntries.length === 0) {
    return {
      hasOpen: false,
      id: null,
    };
  }

  const lastOpen = openEntries[openEntries.length - 1];

  return {
    hasOpen: true,
    id: lastOpen.id,
  };
};


// Storage Functions
const saveEintraege = async (eintraege: Eintrag[]) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_EINTRAEGE, JSON.stringify(eintraege));
  } catch (e) {
    console.error('Fehler beim Speichern Eintraege:', e);
  }
};

const loadEintraege = async (): Promise<Eintrag[]> => {
  try {
    const jsonValue = await AsyncStorage.getItem(STORAGE_KEY_EINTRAEGE);
    return jsonValue ? JSON.parse(jsonValue) : [];
  } catch (e) {
    console.error('Fehler beim Laden Eintraege:', e);
    return [];
  }
};

const saveSplits = async (splits: SplitEntry[]) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_SPLITS, JSON.stringify(splits));
  } catch (e) {
    console.error('Fehler beim Speichern Splits:', e);
  }
};

const loadSplits = async (): Promise<SplitEntry[]> => {
  try {
    const jsonValue = await AsyncStorage.getItem(STORAGE_KEY_SPLITS);
    return jsonValue ? JSON.parse(jsonValue) : [];
  } catch (e) {
    console.error('Fehler beim Laden Splits:', e);
    return [];
  }
};


// Business Logic – ERWEITERT für Split-Logik
const createEntriesWithOptionalSplit = (base: Eintrag) => {
  if (!base.ende) return { entries: [base] };

  const startMin = timeToMinutes(base.start);
  let endMin = timeToMinutes(base.ende);

  if (base.ende === '24:00') {
    endMin = 24 * 60;
  }

  if (endMin >= startMin && endMin <= 24 * 60) {
    return { entries: [base] };
  }

  const id1 = generateId();
  const id2 = generateId();
  const nextDate = base.date; // ggf. getNextDay(base.date)

  const first: Eintrag = {
    id: id1,
    date: base.date,
    start: base.start,
    ende: '24:00',
  };

  const secondEndTime = base.ende;
  const second: Eintrag = {
    id: id2,
    date: nextDate,
    start: '00:00',
    ende: secondEndTime,
  };

  const split: SplitEntry = {
    id: `${id1}-${id2}`,
    firstId: id1,
    secondId: id2,
  };

  return { entries: [first, second], split };
};

// Basis aus einem Split-Paar erstellen
const buildBaseFromSplit = (
  first: Eintrag,
  second: Eintrag
): Eintrag => {
  return {
    id: generateId(),
    date: first.date,
    start: first.start,
    ende: second.ende,
  };
};


// Components
type SpoolButtonProps = { label: string; onStep: () => void };

const SpoolButton: React.FC<SpoolButtonProps> = ({ label, onStep }) => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressedRef = useRef(false);

  const startSpooling = () => {
    onStep();
    pressedRef.current = true;
    const delay = 400;
    const intervalMs = 80;
    setTimeout(() => {
      if (!pressedRef.current) return;
      intervalRef.current = setInterval(onStep, intervalMs);
    }, delay);
  };

  const stopSpooling = () => {
    pressedRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  return (
    <Pressable
      style={styles.timeButton}
      onPressIn={startSpooling}
      onPressOut={stopSpooling}
    >
      <Text style={styles.timeButtonText}>{label}</Text>
    </Pressable>
  );
};


type AuswertungProps = { eintraege: Eintrag[]; splits: SplitEntry[] };

const AuswertungView: React.FC<AuswertungProps> = ({ eintraege, splits }) => {
  const { width } = useWindowDimensions();
  const timelineWidth = width - 40;
  const minutesPerDay = 24 * 60;

  const uniqueDates = Array.from(
    new Set(eintraege.map(e => getAdjustedDateForEntry(e, splits)))
  ).sort().reverse();

  const getBarsForDate = (date: string) => {
    return eintraege
      .filter(e => getAdjustedDateForEntry(e, splits) === date)
      .flatMap(e => {
        const startMin = timeToMinutes(e.start);
        const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        let endMin: number;

        if (e.ende) {
          endMin = e.ende === '24:00' ? 1440 : timeToMinutes(e.ende);
        } else {
          endMin = Math.min(nowMinutes, minutesPerDay);
        }

        const clampedStart = Math.max(0, Math.min(startMin, minutesPerDay));
        const clampedEnd = Math.min(endMin, minutesPerDay);
        const duration = Math.max(0, clampedEnd - clampedStart);

        const left = (clampedStart / minutesPerDay) * timelineWidth;
        const widthPx = (duration / minutesPerDay) * timelineWidth;

        if (duration <= 0) return [];

        return [{
          id: e.id.toString() + (e.ende ? '' : '-open'),
          left,
          width: widthPx,
          isOpen: !e.ende,
        }];
      })
      .filter(b => b.width > 0);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.timelineContainer}>
        {Array.from({ length: 9 }, (_, i) => {
          const hour = i * 3;
          return (
            <View
              key={`line-${hour}`}
              style={[
                styles.timelineFullHeightLine,
                { left: `${(hour / 24) * 100}%` },
              ]}
            />
          );
        })}

        <View style={[styles.timelineScale, { width: '100%' }]}>
          {Array.from({ length: 8 }, (_, i) => {
            const hour = i * 3;
            return (
              <View
                key={hour}
                style={[
                  styles.timelineTickWrapper,
                  { left: `${(hour / 24) * 100}%` },
                ]}
              >
                <Text style={styles.scaleLabel}>{hour}</Text>
              </View>
            );
          })}
        </View>

        <ScrollView style={styles.scrollView}>
          <View style={styles.timelineContainerInner}>
            {uniqueDates.map(date => {
              const bars = getBarsForDate(date);
              const entriesForDate = eintraege.filter(
                e => getAdjustedDateForEntry(e, splits) === date
              );
              const totalDurationForDate = getTotalDurationForEntries(entriesForDate);

              return (
                <View key={date} style={{ marginBottom: 16 }}>
                  <View style={styles.dateRow}>
                    <Text style={styles.auswertungDateLine}>
                      {getWeekdayAbbr(date)} {date}
                    </Text>
                    <Text style={styles.totalDurationText}>{totalDurationForDate}</Text>
                  </View>
                  <View style={[styles.timelineBackground, { width: '100%' }]}>
                    {bars.map(bar => (
                      <View
                        key={bar.id}
                        style={[
                          bar.isOpen ? styles.timelineBarOpen : styles.timelineBar,
                          {
                            left: `${(bar.left / timelineWidth) * 100}%`,
                            width: `${(bar.width / timelineWidth) * 100}%`,
                          },
                        ]}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </View>
  );
};


// Main App Component
const App: React.FC = () => {
  const todayDate = getTodayDate();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [editingStart, setEditingStart] = useState('');
  const [editingEnde, setEditingEnde] = useState('');
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [splits, setSplits] = useState<SplitEntry[]>([]);
  const [screen, setScreen] = useState<'main' | 'auswertung'>('main');

  useEffect(() => {
    const loadData = async () => {
      const savedEintraege = await loadEintraege();
      const savedSplits = await loadSplits();
      const sortedEintraege = [...savedEintraege].sort((a, b) => b.id - a.id);
      setEintraege(sortedEintraege);
      setSplits(savedSplits);
    };
    loadData();
  }, []);

  const updateEintraege = useCallback(async (newEintraege: Eintrag[]) => {
    const sortedEintraege = [...newEintraege].sort((a, b) => b.id - a.id);
    setEintraege(sortedEintraege);
    await saveEintraege(sortedEintraege);
  }, []);

  const updateSplits = useCallback(async (newSplits: SplitEntry[]) => {
    setSplits(newSplits);
    await saveSplits(newSplits);
  }, []);

  const adjustTime = useCallback((value: string, deltaMinutes: number): string => {
    return minutesToTime(timeToMinutes(value) + deltaMinutes);
  }, []);

  const uniqueDates = Array.from(
    new Set(eintraege.map(e => getAdjustedDateForEntry(e, splits)))
  ).sort().reverse();

  const openEntryInfo: OpenEntryInfo = getOpenEntryInfo(eintraege);

  const toggleDate = (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null);
      setSelectedDate(null);
    } else {
      setExpandedDate(date);
      setSelectedDate(date);
    }
  };

  const resetEditState = () => {
    setEditingEntryId(null);
    setEditMode('none');
    setEditingStart('');
    setEditingEnde('');
  };

  // --- Bearbeitungsfunktionen ---

  const handleAddStart = async () => {
    if (openEntryInfo.hasOpen) {
      Alert.alert(
        'Offener Eintrag vorhanden',
        'Es gibt bereits einen unvollständigen Eintrag. Möchtest du trotzdem einen neuen Start hinzufügen?',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Neuen Start',
            onPress: async () => {
              const currentTime = getRoundedNow();
              const newEintraege = [
                ...eintraege,
                {
                  id: generateId(),
                  date: getTodayDate(),
                  start: currentTime,
                },
              ];
              await updateEintraege(newEintraege);
            },
          },
        ],
      );
      return;
    }

    const currentTime = getRoundedNow();
    const newEintraege = [
      ...eintraege,
      {
        id: generateId(),
        date: getTodayDate(),
        start: currentTime,
      },
    ];
    await updateEintraege(newEintraege);
  };

  const handleAddEnde = async () => {
    if (!openEntryInfo.hasOpen || openEntryInfo.id == null) {
      Alert.alert('Info', 'Kein offener Eintrag vorhanden.');
      return;
    }

    const openEntry = eintraege.find(e => e.id === openEntryInfo.id);
    if (!openEntry) {
      Alert.alert('Fehler', 'Offener Eintrag wurde nicht gefunden.');
      return;
    }

    const currentTime = getRoundedNow();
    const base: Eintrag = { ...openEntry, ende: currentTime };
    const { entries, split } = createEntriesWithOptionalSplit(base);

    let newEintraege = eintraege.filter(e => e.id !== openEntry.id);
    newEintraege = [...newEintraege, ...entries];
    await updateEintraege(newEintraege);

    let newSplits = splits.filter(
      s => s.firstId !== openEntry.id && s.secondId !== openEntry.id
    );

    if (split) {
      newSplits = [...newSplits, split];
    }

    await updateSplits(newSplits);
  };

  const handleAddFixedNoonEntry = (date: string) => {
    Alert.alert(
      'Neuen Eintrag hinzufügen',
      `Möchtest du für ${date} einen Eintrag von 12:00 bis 12:00 hinzufügen?`,
      [
        {
          text: 'Abbrechen',
          style: 'cancel',
        },
        {
          text: 'Hinzufügen',
          onPress: async () => {
            const newEintrag: Eintrag = {
              id: generateId(),
              date,
              start: '12:00',
              ende: '12:00',
            };

            await updateEintraege([...eintraege, newEintrag]);
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleSaveEdit = async () => {
    if (!editingEntryId) return;

    if (editMode === 'start' && !editingStart) {
      Alert.alert('Fehler', 'Startzeit erforderlich.');
      return;
    }
    if (editMode === 'ende' && !editingEnde) {
      Alert.alert('Fehler', 'Endzeit erforderlich.');
      return;
    }

    const original = eintraege.find(e => e.id === editingEntryId);
    if (!original) {
      resetEditState();
      return;
    }

    const existingSplit = splits.find(
      s => s.firstId === original.id || s.secondId === original.id
    );

    let newEintraege = eintraege;
    let newSplits = splits;

    if (existingSplit) {
      const first = eintraege.find(e => e.id === existingSplit.firstId);
      const second = eintraege.find(e => e.id === existingSplit.secondId);

      if (!first || !second) {
        // Fallback: wie bisher nur aktuellen bearbeiten
        newEintraege = eintraege.filter(e => e.id !== original.id);
        newSplits = splits.filter(s => s.id !== existingSplit.id);

        let base: Eintrag = {
          ...original,
          id: generateId(),
        };

        if (editMode === 'start') {
          base.start = editingStart;
        } else {
          base.ende = editingEnde;
        }

        const { entries, split } = createEntriesWithOptionalSplit(base);
        newEintraege = [...newEintraege, ...entries];
        await updateEintraege(newEintraege);

        if (split) {
          newSplits = [...newSplits, split];
        }
        await updateSplits(newSplits);
        resetEditState();
        return;
      }

      // beide Einträge des Splits entfernen
      newEintraege = eintraege.filter(
        e => e.id !== existingSplit.firstId && e.id !== existingSplit.secondId
      );
      newSplits = splits.filter(s => s.id !== existingSplit.id);

      // gemeinsame Basis aus beiden Einträgen
      let base = buildBaseFromSplit(first, second);

      if (editMode === 'start') {
        base.start = editingStart;
      } else {
        base.ende = editingEnde;
      }

      const { entries, split } = createEntriesWithOptionalSplit(base);

      newEintraege = [...newEintraege, ...entries];
      await updateEintraege(newEintraege);

      if (split) {
        newSplits = [...newSplits, split];
      }
      await updateSplits(newSplits);
      resetEditState();
      return;
    }

    // Fall: kein Split
    newEintraege = eintraege.filter(e => e.id !== original.id);

    let base: Eintrag = { 
      ...original,
      id: generateId(),
    };

    if (editMode === 'start') {
      base.start = editingStart;
    } else {
      base.ende = editingEnde;
    }

    const { entries, split } = createEntriesWithOptionalSplit(base);

    newEintraege = [...newEintraege, ...entries];
    await updateEintraege(newEintraege);

    if (split) {
      newSplits = [...newSplits, split];
    }

    await updateSplits(newSplits);
    resetEditState();
  };

  const startEditing = (id: number, mode: EditMode) => {
    setEditingEntryId(id);
    setEditMode(mode);
    const entry = eintraege.find(e => e.id === id);
    if (mode === 'start') {
      setEditingStart(entry?.start || getRoundedNow());
    } else {
      setEditingEnde(entry?.ende || getRoundedNow());
    }
  };

  const handleDeleteEntry = (id: number) => {
    Alert.alert(
      'Eintrag löschen',
      'Möchtest du diesen Eintrag wirklich löschen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            const relatedSplit = splits.find(
              s => s.firstId === id || s.secondId === id
            );

            let newEintraege = eintraege;
            let newSplits = splits;

            if (relatedSplit) {
              newEintraege = eintraege.filter(
                e => e.id !== relatedSplit.firstId && e.id !== relatedSplit.secondId
              );
              newSplits = splits.filter(s => s.id !== relatedSplit.id);
            } else {
              newEintraege = eintraege.filter(e => e.id !== id);
            }

            await updateEintraege(newEintraege);
            await updateSplits(newSplits);

            if (editingEntryId === id) resetEditState();
          },
        },
      ],
      { cancelable: true },
    );
  };

  // --- Rendering-Funktionen ---

  const renderRow = ({ item }: { item: Eintrag }) => {
    const durationStr = getDuration(item.start, item.ende);
    const endDisplay = item.ende ? item.ende : '⏳ Endzeit fehlt';

    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.cell, { flex: 1 }]}
          onPress={() => startEditing(item.id, 'start')}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.cellText,
              editingEntryId === item.id && editMode === 'start' ? styles.editingText : undefined,
            ]}
          >
            {item.start}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.cell, { flex: 1 }]}
          onPress={() => startEditing(item.id, 'ende')}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.cellText,
              editingEntryId === item.id && editMode === 'ende' ? styles.editingText : undefined,
            ]}
          >
            {endDisplay}
          </Text>
        </TouchableOpacity>

        <Text
          style={[
            styles.cell,
            styles.durationCell,
            item.ende ? styles.durationComplete : styles.durationPending,
          ]}
        >
          {durationStr}
        </Text>

        <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteEntry(item.id)}>
          <Text style={styles.deleteButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderDateSection = (date: string) => {
    const entriesForDate = eintraege
      .filter(e => getAdjustedDateForEntry(e, splits) === date)
      .sort((a, b) => timeToMinutes(b.start) - timeToMinutes(a.start));
    const dayTotal = getTotalDurationForEntries(entriesForDate);
    const dayCompleted = entriesForDate.filter(e => e.ende).length;
    const isExpanded = expandedDate === date;
    const isSelected = selectedDate === date;

    return (
      <View key={date} style={styles.dateSection}>
        <TouchableOpacity
          style={[
            styles.dateHeader,
            isSelected && styles.selectedHeader,
            isExpanded && styles.expandedHeader,
          ]}
          onPress={() => toggleDate(date)}
          activeOpacity={0.7}
        >
          <View style={styles.dateHeaderLeft}>
            <Text
              style={[
                styles.dateHeaderText,
                isSelected && styles.selectedText,
              ]}
            >
              {getWeekdayAbbr(date)} {date}
            </Text>
            <Text style={styles.dateHeaderCount}>{dayCompleted}/{entriesForDate.length}</Text>
          </View>
          <Text style={styles.dateHeaderTotal}>{dayTotal}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.entriesContainer}>
            <View style={styles.dateRow}>
              <Text style={styles.auswertungDateLine}>
                {getWeekdayAbbr(date)} {date}
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {isSelected && (
                  <TouchableOpacity
                    style={styles.noonButton}
                    onPress={() => handleAddFixedNoonEntry(date)}
                  >
                    <Text style={styles.noonButtonText}>Nachtrag</Text>
                  </TouchableOpacity>
                )}

                <Text style={styles.totalDurationText}>{dayTotal}</Text>
              </View>
            </View>

            {entriesForDate.map(item => (
              <View key={item.id}>{renderRow({ item })}</View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={[styles.headerButton, screen === 'main' && styles.headerButtonActive]}
          onPress={() => setScreen('main')}
        >
          <Text style={[styles.headerButtonText, screen === 'main' && { color: '#fff' }]}>
            Erfassung
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.headerButton, screen === 'auswertung' && styles.headerButtonActive]}
          onPress={() => setScreen('auswertung')}
        >
          <Text style={[styles.headerButtonText, screen === 'auswertung' && { color: '#fff' }]}>
            Auswertung
          </Text>
        </TouchableOpacity>
      </View>

      {screen === 'main' ? (
        <>
          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {editingEntryId && (
              <View style={styles.editForm}>
                <Text style={styles.editTitle}>
                  {editMode === 'start' ? 'Startzeit' : 'Endzeit'} bearbeiten:{' '}
                  {editMode === 'start' ? editingStart : editingEnde}
                </Text>
                <View style={styles.editControls}>
                  <SpoolButton
                    label="-"
                    onStep={() => {
                      if (editMode === 'start') {
                        setEditingStart(prev => adjustTime(prev || '00:00', -5));
                      } else {
                        setEditingEnde(prev => adjustTime(prev || '00:00', -5));
                      }
                    }}
                  />
                  <SpoolButton
                    label="+"
                    onStep={() => {
                      if (editMode === 'start') {
                        setEditingStart(prev => adjustTime(prev || '00:00', +5));
                      } else {
                        setEditingEnde(prev => adjustTime(prev || '00:00', +5));
                      }
                    }}
                  />
                </View>
                <Button title="Änderung speichern" onPress={handleSaveEdit} color="#558130" />
                <Button
                  title="Abbrechen"
                  onPress={resetEditState}
                  color="#cc5852"
                />
              </View>
            )}

            {uniqueDates.map(renderDateSection)}
          </ScrollView>

          <View style={styles.bottomButtons}>
            {openEntryInfo.hasOpen ? (
              <TouchableOpacity style={styles.addButton} onPress={handleAddEnde}>
                <Text style={styles.addButtonText}>Ende</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.addButton, styles.addStartButton]}
                onPress={handleAddStart}
              >
                <Text style={styles.addButtonText}>Start</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : (
        <AuswertungView eintraege={eintraege} splits={splits} />
      )}
    </View>
  );
};


const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 20, 
    backgroundColor: '#2C1F15',
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: 25,
    marginTop: 10,
  },
  headerButton: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#D4A574',
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  headerButtonActive: {
    backgroundColor: '#D4A574',
  },
  headerButtonText: {
    color: '#D4A574',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  editForm: {
    backgroundColor: '#3D2A1E',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  editTitle: { 
    fontSize: 18, 
    fontWeight: '600', 
    color: '#F8E8C8',
    marginBottom: 10 
  },
  editControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
    marginBottom: 15,
  },
  timeButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#D4A574',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  timeButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#4A3627',
    backgroundColor: '#352616',
    alignItems: 'center',
  },
  cell: { flex: 1, padding: 5 },
  durationCell: {
    flex: 0.8,
    textAlign: 'right',
    fontWeight: '600',
  },
  cellText: { 
    fontSize: 16, 
    fontWeight: '500',
    color: '#F8E8C8',
  },
  durationPending: { color: '#F4B95F' },
  durationComplete: { color: '#8BC34A', fontWeight: 'bold' },
  editingText: {
    backgroundColor: '#D4A574',
    color: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontWeight: 'bold',
  },
  deleteButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  deleteButtonText: {
    fontSize: 18,
    color: '#FF8A65',
  },
  dateSection: {
    marginBottom: 12,
  },
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#4A3627',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#6B4E38',
  },
  selectedHeader: {
    backgroundColor: '#3D2A1E',
    borderColor: '#D4A574',
  },
  expandedHeader: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dateHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateHeaderText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8E8C8',
    marginRight: 8,
  },
  selectedText: {
    color: '#D4A574',
  },
  dateHeaderCount: {
    fontSize: 14,
    color: '#D9C4A8',
  },
  dateHeaderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8BC34A',
  },
  entriesContainer: {
    backgroundColor: '#352616',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#6B4E38',
    overflow: 'hidden',
    paddingBottom: 8,
    paddingTop: 4,
  },
  bottomButtons: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    zIndex: 100,
  },
  addButton: {
    backgroundColor: '#FF8A65',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    minWidth: 160,
    alignItems: 'center',
  },
  addStartButton: {
    backgroundColor: '#8BC34A',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  auswertungDateLine: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8E8C8',
  },
  totalDurationText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8BC34A',
  },
  timelineContainer: {
    marginTop: 10,
    paddingTop: 10,
    paddingBottom: 10,
    position: 'relative',
    flex: 1,
  },
  timelineContainerInner: {
    width: '100%',
  },
  timelineScale: {
    height: 20,
    position: 'relative',
    marginBottom: 10,
  },
  timelineTickWrapper: {
    position: 'absolute',
    alignItems: 'center',
    transform: [{ translateX: -0.5 }],
  },
  scaleLabel: {
    fontSize: 12,
    color: '#D9C4A8',
    fontWeight: 'bold',
  },
  timelineFullHeightLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#6B4E38',
  },
  timelineBackground: {
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4A3627',
    overflow: 'hidden',
    position: 'relative',
  },
  timelineBar: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: 6,
    backgroundColor: '#8BC34A',
  },
  timelineBarOpen: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: 6,
    backgroundColor: '#FF8A65',
  },
  noonButton: {
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#D4A574',
  },
  noonButtonText: {
    color: '#2C1F15',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default App;
