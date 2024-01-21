import { getCategories, randomId } from '@/lib/api'
import { getPrisma } from '@/lib/prisma'
import { Prisma, SplitMode } from '@prisma/client'
import csv from 'csv-parser'
import fs from 'fs'
import { Client } from 'pg'
import fr from './fr.json'

const frCategories: Record<string, string> = fr

async function writeData(groupName: string, currency: string, data: any) {
  const prisma = await getPrisma()

  // Get map of category name to ID
  const categoryMapping: Record<string, number> = {}
  const categories = await getCategories()

  for (const categoryRow of categories) {
    categoryMapping[categoryRow.name.toLowerCase()] = categoryRow.id
  }

  // Create the Group
  const groupId = randomId()
  const group: Prisma.GroupCreateInput = {
    id: groupId,
    name: groupName,
    currency: currency,
    createdAt: new Date(),
  }

  const participantIdsMapping: Record<string, string> = {}
  const participants: Prisma.ParticipantCreateManyInput[] = []

  // Find Participants and add
  const participantList = Object.keys(data[0]).slice(5)

  for (const participant of participantList) {
    const id = randomId()
    participantIdsMapping[participant] = id

    participants.push({
      id,
      groupId: groupId,
      name: participant,
    })
  }

  // Iterate expense data and add expenses
  const expenses: Prisma.ExpenseCreateManyInput[] = []
  const expenseParticipants: Prisma.ExpensePaidForCreateManyInput[] = []

  for (const expenseRow of data) {
    const id = randomId()
    let paidBy: string = ''

    // replace the "other" category names. e.g. "Entertainment - other" -> "Entertainment"
    let expenseCategory = expenseRow.Category.toLowerCase().replace(
      ' - other',
      '',
    )
    expenseCategory = expenseCategory.replace(' - autre', '')

    // fr to en
    if (frCategories[expenseCategory] === undefined) {
      throw new Error('Category not found: ' + expenseCategory)
    }

    expenseCategory = frCategories[expenseCategory]

    let splitMode: SplitMode = SplitMode.EVENLY

    for (const participant of participantList) {
      const participantShare = expenseRow[participant]
      if (participantShare > 0) {
        paidBy = participant
      } else {
        if (expenseCategory == 'payment' && participantShare < 0) {
          expenseParticipants.push({
            expenseId: id,
            participantId: participantIdsMapping[participant],
          })
        }
      }

      if (
        participantShare != 0 &&
        participantShare != expenseRow.Cost &&
        expenseCategory != 'payment'
      ) {
        expenseParticipants.push({
          expenseId: id,
          participantId: participantIdsMapping[participant],
        })
      }

      const absVal = Math.abs(participantShare)
      const halfRound = Math.round((expenseRow.Cost * 100) / 2) / 100
      const halfFloor = Math.floor((expenseRow.Cost * 100) / 2) / 100
      const halfCeil = Math.ceil((expenseRow.Cost * 100) / 2) / 100

      if (
        expenseRow[participant] != 0 &&
        (absVal != halfRound || absVal != halfCeil || absVal == halfFloor) &&
        (absVal != halfFloor || absVal != halfCeil || absVal == halfRound) &&
        (absVal != halfFloor || absVal != halfRound || absVal == halfCeil) &&
        absVal != expenseRow.Cost &&
        absVal != halfRound &&
        absVal != halfFloor &&
        absVal != halfCeil
      ) {
        console.log(
          JSON.stringify(expenseRow) +
            ' : ' +
            absVal +
            ', ' +
            halfRound +
            ', ' +
            halfFloor +
            ', ' +
            halfCeil,
        )

        splitMode = SplitMode.BY_AMOUNT

        const paidExpenseParticipant = expenseParticipants.find(
          (ep) =>
            ep.expenseId === id &&
            ep.participantId === participantIdsMapping[participant],
        )
        if (paidExpenseParticipant === undefined) {
          throw new Error('participant not found: ' + paidBy)
        }

        if (paidBy === participant) {
          paidExpenseParticipant.shares = expenseRow.Cost - participantShare
        } else {
          paidExpenseParticipant.shares = absVal
        }

        paidExpenseParticipant.shares *= 100
        console.log(paidExpenseParticipant.shares)
      }
    }

    if (paidBy !== '') {
      expenses.push({
        id,
        amount: Math.round(Number(expenseRow.Cost) * 100),
        groupId: groupId,
        title: expenseRow.Description,
        expenseDate: new Date(expenseRow.Date),
        categoryId:
          expenseCategory === 'payment'
            ? 1
            : categoryMapping[expenseCategory] ?? 1,
        createdAt: new Date(),
        isReimbursement: expenseCategory === 'payment',
        paidById: participantIdsMapping[paidBy],
        splitMode: splitMode,
      })
    }
  }

  console.log('Creating group:', group)
  await prisma.group.create({ data: group })

  console.log('Creating participants:', participants)
  await prisma.participant.createMany({ data: participants })

  console.log('Creating expenses:', expenses)
  await prisma.expense.createMany({ data: expenses })

  console.log('Creating expenseParticipants:', expenseParticipants)
  await prisma.expensePaidFor.createMany({ data: expenseParticipants })

  console.log(groupId)
}

async function main() {
  const groupName = 'Splitwise'
  const currency = '€'
  const fileName = './2024-01-16_export.csv'

  withClient(async (client) => {
    // Load CSV
    const data: any = []

    fs.createReadStream(fileName)
      .pipe(csv())
      .on('data', (r) => {
        // console.log(r);
        data.push(r)
      })
      .on('end', async () => {
        // console.log(data);
        await writeData(groupName, currency, data)
      })
  })
}

async function withClient(fn: (client: Client) => void | Promise<void>) {
  const client = new Client({
    connectionString: process.env.POSTGRES_PRISMA_URL,
    ssl: false,
  })
  await client.connect()
  console.log('Connected.')

  try {
    await fn(client)
  } finally {
    await client.end()
    console.log('Disconnected.')
  }
}

// Run using: npx tsx import.ts
main().catch(console.error)
