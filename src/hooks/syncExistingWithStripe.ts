import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { APIError } from 'payload'
import Stripe from 'stripe'

import type { StripePluginConfig } from '../types.js'

import { deepen } from '../utilities/deepen.js'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
// api version can only be the latest, stripe recommends ts ignoring it
const stripe = new Stripe(stripeSecretKey || '', { apiVersion: '2022-08-01' })

type HookArgsWithCustomCollection = Omit<
  Parameters<CollectionBeforeChangeHook>[0],
  'collection'
> & {
  collection: CollectionConfig
}

export type CollectionBeforeChangeHookWithArgs = (
  args: HookArgsWithCustomCollection & {
    collection?: CollectionConfig
    pluginConfig?: StripePluginConfig
  },
) => void

export const syncExistingWithStripe: CollectionBeforeChangeHookWithArgs = async (args) => {
  const { collection, data, operation, originalDoc, pluginConfig, req } = args

  const { logs, sync } = pluginConfig || {}

  const { payload } = req

  const { slug: collectionSlug } = collection || {}

  if (process.env.NODE_ENV !== 'test' && !data.skipSync) {
    const syncConfig = sync?.find((conf) => conf.collection === collectionSlug)

    if (syncConfig) {
      if (operation === 'update') {
        // combine all fields of this object and match their respective values within the document
        let syncedFields = syncConfig.fields.reduce(
          (acc, field) => {
            const { fieldPath, stripeProperty } = field

            acc[stripeProperty] = data[fieldPath]
            return acc
          },
          {} as Record<string, any>,
        )

        syncedFields = deepen(syncedFields)

        if (logs)
          payload.logger.info(
            `A '${collectionSlug}' document has changed in Payload with ID: '${originalDoc?._id}', syncing with Stripe...`,
          )

        if (!data.stripeID) {
          // NOTE: the "beforeValidate" hook populates this
          if (logs) payload.logger.error(`- There is no Stripe ID for this document, skipping.`)
        } else {
          if (logs)
            payload.logger.info(`- Syncing to Stripe resource with ID: '${data.stripeID}'...`)

          try {
            const stripeResource = await stripe?.[syncConfig?.stripeResourceType]?.update(
              data.stripeID,
              syncedFields,
            )

            if (logs)
              payload.logger.info(
                `✅ Successfully synced Stripe resource with ID: '${stripeResource.id}'.`,
              )
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : error
            throw new APIError(`Failed to sync document with ID: '${data.id}' to Stripe: ${msg}`)
          }
        }
      }
    }
  }

  // Set back to 'false' so that all changes continue to sync to Stripe, see note in './createNewInStripe.ts'
  data.skipSync = false

  return data
}
