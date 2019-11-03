import {
  FlaggOpts,
  FlaggStorage,
  FlagDefinition,
  FlagDefinitions,
  FlagValue,
  FlaggReadOnlyStorage,
  FlaggStorageInput
} from './defs';

export * from './defs';

type ReadOrWriteStorage = FlaggStorage | FlaggReadOnlyStorage;

const DEFAULT_STORAGE_NAME = '_default';

/** Ensures a value is an array */
const makeArray = <T>(val: T) =>
  Array.isArray(val) ? (val as T) : !!val ? ([val] as T[]) : [];

/** Takes a single or array of storage items and makes a name -> value map */
const makeStorageMap = (
  _storage: FlaggStorageInput
): { [storageName: string]: ReadOrWriteStorage } => {
  const storageArr = makeArray(_storage) as ReadOrWriteStorage[];
  return storageArr.reduce<{
    [storageName: string]: ReadOrWriteStorage;
  }>(
    (acc, storage) => {
      acc[storage.name] = storage;
      return acc;
    },
    { [DEFAULT_STORAGE_NAME]: storageArr[0] }
  );
};

/** Get the default value for a flag from its definition */
const getFlagDefaultValue = ({ flagDef }: { flagDef: FlagDefinition }) =>
  flagDef.default === undefined ? null : flagDef.default;

/** Get the value set for the flag for its storage */
const getFlagValue = ({
  flagDef,
  flagName,
  storageMap
}: {
  flagDef: FlagDefinition;
  flagName: string;
  storageMap: { [storageName: string]: ReadOrWriteStorage };
}) => {
  const storage = resolveFlagStorage({ flagDef, storageMap });
  return storage.get(flagName);
};

/** Get the fully resolved flag value taking into account the default fallback */
const getResolvedFlagValue = ({
  definitions,
  flagName,
  storageMap
}: {
  definitions: FlagDefinitions;
  flagName: string;
  storageMap: { [storageName: string]: ReadOrWriteStorage };
}) => {
  const flagDef = getFlagDef({ definitions, flagName });

  if (!flagDef) {
    return null;
  }

  const defaultValue = getFlagDefaultValue({
    flagDef
  });

  const value = getFlagValue({
    flagDef,
    flagName,
    storageMap
  });

  if (value === undefined || value === null) {
    return defaultValue;
  }

  return value;
};

/** Get the fully resolved flag value taking into account the default fallback */
const setFlagValue = ({
  definitions,
  flagName,
  value,
  storageMap
}: {
  value: FlagValue;
  definitions: FlagDefinitions;
  flagName: string;
  storageMap: { [storageName: string]: ReadOrWriteStorage };
}) => {
  const flagDef = getFlagDef({ definitions, flagName });
  const storage = resolveFlagStorage({ flagDef, storageMap });
  const defaultValue = getFlagDefaultValue({
    flagDef
  });

  if (JSON.stringify(value) === JSON.stringify(defaultValue)) {
    /* istanbul ignore else  */
    if ('remove' in storage) {
      storage.remove(flagName);
    } else {
      console.warn(
        `Flagg: Attempting to write to readOnly storage ${storage.name}`
      );
    }
  } else {
    if ('set' in storage) {
      storage.set(flagName, value);
    } else {
      console.warn(
        `Flagg: Attempting to write to readOnly storage ${storage.name}`
      );
    }
  }
};

/** Get the definition for a flag */
const getFlagDef = ({
  definitions,
  flagName
}: {
  definitions: FlagDefinitions;
  flagName: string;
}) => definitions[flagName];

/** Get the storage instance for a flag definition */
const resolveFlagStorage = ({
  flagDef,
  storageMap
}: {
  flagDef: FlagDefinition;
  storageMap: { [storageName: string]: ReadOrWriteStorage };
}) => {
  const storageName = flagDef.storage as string;
  if (storageMap[storageName]) return storageMap[storageName];

  if (storageName !== undefined) {
    console.warn(
      `Flagg storage "${storageName}" not available. Did you forget to include it? Using default storage instead.`
    );
  }
  return storageMap[DEFAULT_STORAGE_NAME];
};

const getFlagType = ({ flagDef }: { flagDef: FlagDefinition }) => {
  if (flagDef.options) {
    return 'select';
  }

  if (typeof flagDef.default === 'string') {
    return 'string';
  }

  return 'boolean';
};

/** Create a new feature flags store with Flagg. */
export const flagg = <FFKeys extends string>({
  storage,
  definitions: _definitions = {},
  hydrateFrom
}: FlaggOpts) => {
  let definitions = _definitions;
  const storageMap = makeStorageMap(storage);
  const hydrateFromStorages = makeArray(
    hydrateFrom
  ) as FlaggReadOnlyStorage[];

  const hydrate = () => {
    hydrateFromStorages.forEach(async hydrateStorage => {
      const values = await hydrateStorage.all();
      set(values as Partial<{ [key in FFKeys]: FlagValue }>);
    });
  };

  const get = (flagName: FFKeys): FlagValue =>
    getResolvedFlagValue({
      definitions,
      flagName: String(flagName),
      storageMap
    });

  const getDefault = (flagName: FFKeys): FlagValue =>
    getFlagDefaultValue({
      flagDef: getFlagDef({ definitions, flagName })
    });

  const isOn = (flagName: FFKeys): boolean => !!get(flagName);

  const set = (
    flagNameOrFlags: FFKeys | Partial<{ [key in FFKeys]: FlagValue }>,
    value?: FlagValue
  ) => {
    if (typeof flagNameOrFlags === 'string') {
      value !== undefined &&
        setFlagValue({
          value,
          definitions,
          flagName: String(flagNameOrFlags),
          storageMap
        });
    } else {
      Object.entries(flagNameOrFlags).forEach(([flagName, value]) => {
        setFlagValue({
          value: value as FlagValue,
          definitions,
          flagName: String(flagName),
          storageMap
        });
      });
    }
  };

  const isOverridden = (flagName: FFKeys) => {
    const flagDef = getFlagDef({ flagName, definitions });
    const type = getFlagType({ flagDef });
    return type === 'boolean'
      ? isOn(flagName) !== !!getDefault(flagName)
      : get(flagName) !== getDefault(flagName);
  };

  const setDefinitions = (newDefinitions: FlagDefinitions) => {
    definitions = newDefinitions;
    hydrate();
  };

  const getDefinitions = () => definitions;

  const getAllResolved = () => {
    return Object.keys(definitions).reduce<
      Partial<{ [key in FFKeys]: FlagValue }>
    >((acc, flagName) => {
      acc[flagName as FFKeys] = get(flagName as FFKeys);
      return acc;
    }, {});
  };

  const getAllOverridden = () => {
    return Object.keys(definitions).reduce<
      Partial<{ [key in FFKeys]: FlagValue }>
    >((acc, flagName) => {
      if (isOverridden(flagName as FFKeys)) {
        acc[flagName as FFKeys] = get(flagName as FFKeys);
      }
      return acc;
    }, {});
  };

  hydrate();

  return {
    isOn,
    get,
    set,
    getDefault,
    isOverridden,
    setDefinitions,
    getDefinitions,
    getAllResolved,
    getAllOverridden
  };
};

export default flagg;
