import "../lib/main.tsp";

using JustTheType;

/** Identifies a pet across the store. */
scalar petId extends int64;

@tsType("Dayjs", "dayjs")
scalar timestamp extends utcDateTime;

@literalUnion
enum PetKind {
  Dog: "dog",
  Cat: "cat",
}

/** A pet in the store. */
model Pet {
  @readonly id: petId;
  name: string;
  kind: PetKind;
  @tsType("Date") birthDate?: plainDate;
  registeredAt: timestamp;
  tags: string[];
  attributes: Record<unknown>;
  homepage: "https://pets.example/${string}";
}

model Dog extends Pet {
  kind: PetKind.Dog;
  goodBoy: true;
}

model Pets is Pet[];

model Page<T extends {}> {
  items: T[];
  next?: string;
}

union SearchResult {
  page: Page<Pet>,
  message: string,
}

@promise op getPet(id: petId, includeDetails?: boolean): Pet | null;

@promise
interface PetStore {
  get(id: petId): Pet;
  list(): Page<Pet>;
  search(q: string): SearchResult;
}
